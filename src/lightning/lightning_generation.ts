import * as renderer from '../renderer';
import lightningShader from '../shaders/lightning.wgsl';

// Fixed channel ranges avoid append races between independent branches.
export const lightningLayout = {
    primaryNodes: 512,
    secondaryChannels: 16,
    secondaryNodes: 128,
    tertiaryChannels: 32,
    tertiaryNodes: 64,
    primaryAttractors: 2049,
    secondaryAttractors: 257,
    tertiaryAttractors: 129,
};
const maxNodes = lightningLayout.primaryNodes;
const totalNodes = maxNodes + lightningLayout.secondaryChannels * lightningLayout.secondaryNodes +
    lightningLayout.tertiaryChannels * lightningLayout.tertiaryNodes;
const totalChannels = 1 + lightningLayout.secondaryChannels + lightningLayout.tertiaryChannels;
const totalAttractors = lightningLayout.primaryAttractors +
    lightningLayout.secondaryChannels * lightningLayout.secondaryAttractors +
    lightningLayout.tertiaryChannels * lightningLayout.tertiaryAttractors;
const resultBytes = 32;
const stepsPerDispatch = 32;

export function createSeededRandom(seed: number) {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(value ^ (value >>> 15), value | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

// First we create the attractors

// Attractor struct
export interface Attractor {
  position: [number, number, number];
  active: boolean;
}

/* 
    Creation of the attractors:
    - startPoint: where we begin our bolt
    - endPoint: where we end our bolt
    - pointCount: how many attractors we want
    - radius: radius of our attractor cloud (we do a cylinder for the volume)
*/
export function generateAttractors(
  startPoint: [number, number, number],
  endPoint: [number, number, number],
  pointCount: number,
  radius: number,
  seed = 12345
): Attractor[] {
  const attractors: Attractor[] = [];
  const random = createSeededRandom(seed);

  for (let i = 0; i < pointCount; i++) {
    const t = random();
    const angle = random() * Math.PI * 2;
    const r = radius * Math.sqrt(random());

    const x = startPoint[0] + (endPoint[0] - startPoint[0]) * t + r * Math.cos(angle);
    const y = startPoint[1] + (endPoint[1] - startPoint[1]) * t;
    const z = startPoint[2] + (endPoint[2] - startPoint[2]) * t + r * Math.sin(angle);

    attractors.push({position: [x, y, z], active: true,});
  }

  return attractors;
}

// Creating the buffer for the attractors
export function createAttractorBuffer(
  device: GPUDevice,
  attractors: Attractor[],
  capacity = attractors.length
): GPUBuffer {
  const data = packAttractors(attractors);

  const buffer = device.createBuffer({
    label: "Attractors",
    size: capacity * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function packAttractors(attractors: Attractor[]) {
  const data = new Float32Array(attractors.length * 4);

  for (let i = 0; i < attractors.length; i++) {
    const offset = i * 4;

    data[offset] = attractors[i].position[0];
    data[offset + 1] = attractors[i].position[1];
    data[offset + 2] = attractors[i].position[2];
    data[offset + 3] = attractors[i].active ? 1 : 0;
  }

  return data;
}

// Creating da pipeline
export function createLightningPipeline(
  device: GPUDevice,
  entryPoint = 'main',
  layout: GPUPipelineLayout | 'auto' = 'auto',
  module?: GPUShaderModule
): GPUComputePipeline {

  const shaderModule = module ?? device.createShaderModule({
    label: 'Lightning Growth Shader',
    code: lightningShader,
  });

  const pipeline = device.createComputePipeline({
    label: 'Lightning Growth Pipeline',
    layout,
    compute: {
      module: shaderModule,
      entryPoint,
      constants: ['main', 'growSecondary', 'growTertiary'].includes(entryPoint) ? { stepsPerDispatch } : {},
    },
  });

  return pipeline;
}

// we can pass these in rn. lmk if yall want others added
export interface LightningParameters {
    influenceRadius: number;
    deletionRadius: number;
    stepLength: number;
    directionWeight: number;
    seed: number;
    secondaryMinLengthPercent: number;
    secondaryMaxLengthPercent: number;
    secondaryProbabilityPercent: number;
    tertiaryMinLengthPercent: number;
    tertiaryMaxLengthPercent: number;
    tertiaryProbabilityPercent: number;
}

export const defaultLightningParameters: LightningParameters = {
    influenceRadius: 0.75,
    deletionRadius: 0.15,
    stepLength: 0.1,
    directionWeight: 0.6,
    seed: 12345,
    secondaryMinLengthPercent: 10,
    secondaryMaxLengthPercent: 20,
    secondaryProbabilityPercent: 18,
    tertiaryMinLengthPercent: 20,
    tertiaryMaxLengthPercent: 30,
    tertiaryProbabilityPercent: 6,
};

export class LightningGeneration {
    params = { ...defaultLightningParameters };
    debugReveal = { duration: 2.0 };
    debugInfo = {
        status: 'Waiting to generate',
        nodeCount: 1,
        endpointDistance: 10,
        generationMs: 0,
        secondaryCount: 0,
        tertiaryCount: 0,
        failedBranches: 0,
    };
    revealDepth = 0;
    readonly nodeCapacity = totalNodes;
    lightningRevealBuffer: GPUBuffer;
    private channelBuffer: GPUBuffer;
    private branchPipelines: Record<string, GPUComputePipeline>;
    private revealElapsed = 0;
    private maximumDepth = 0;
    private generationId = 0;
    private needsGeneration = true;
    private readback?: { buffer: GPUBuffer; generationId: number; startTime: number; started: boolean };
    private parameterBuffer: GPUBuffer;
    attractorBuffer: GPUBuffer;
    lightningPipeline: GPUComputePipeline;
    lightningBindGroup: GPUBindGroup;
    lightningNodeBuffer: GPUBuffer;

    // we have a cap on the how many nodes can be made for the lightning bolt. just setting that here
    readonly primaryPointCapacity = maxNodes;

    // REBECCA AND ROSE LOOK: this is where the positions for the main bolts nodes will be
    // layout is u32 count for the number of nodes that make up the main bolt + 12 bytes padding, then positions for the nodes. 
    lightningBoltPointBuffer: GPUBuffer;
    
    // current nodes for the lightning bolt
    lightningStateBuffer: GPUBuffer;

    constructor() {
      // default start and end point, number of attractors, and radius
        const attractors = generateAttractors(
            [0, 5, 0],
            [0, -5, 0],
            2048,
            2.0,
            this.params.seed
        );

        //adding last pt in attractor list
        attractors.push({
            position: [0, -5, 0],
            active: true,
        });

        this.attractorBuffer = createAttractorBuffer(renderer.device, attractors, totalAttractors);
        const bindGroupLayout = renderer.device.createBindGroupLayout({
            label: 'Lightning Generation Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const layout = renderer.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const module = renderer.device.createShaderModule({ label: 'Lightning Growth Shader', code: lightningShader });
        this.lightningPipeline = createLightningPipeline(renderer.device, 'main', layout, module);
        this.branchPipelines = {};
        for (const entryPoint of ['prepareSecondary', 'growSecondary', 'prepareTertiary', 'growTertiary', 'summarize']) {
            this.branchPipelines[entryPoint] = createLightningPipeline(renderer.device, entryPoint, layout, module);
        }
        this.channelBuffer = renderer.device.createBuffer({
            label: 'Lightning Channels', size: totalChannels * 64,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.lightningRevealBuffer = renderer.device.createBuffer({
            label: 'Lightning Debug Reveal', size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        renderer.device.queue.writeBuffer(this.lightningRevealBuffer, 0, new Float32Array(4));
        this.parameterBuffer = renderer.device.createBuffer({
            label: 'Lightning Parameters',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uploadParameters(defaultLightningParameters);

        this.lightningBoltPointBuffer = renderer.device.createBuffer({
            label: 'Main Lightning Points and Count', size: 16 + maxNodes * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        this.lightningNodeBuffer = renderer.device.createBuffer({
            label: 'Lightning Nodes',
            size: totalNodes * 32,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const startPoint = this.initialNode();
        renderer.device.queue.writeBuffer(
          this.lightningNodeBuffer,
          0,
          startPoint
        );

        this.lightningStateBuffer = renderer.device.createBuffer({
          label: 'Lightning State',
          size: resultBytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        renderer.device.queue.writeBuffer(
          this.lightningStateBuffer,
          0,
          this.initialState()
        );

        this.lightningBindGroup = renderer.device.createBindGroup({
          label: 'Lightning Growth Bind Group',
          layout: bindGroupLayout,
          entries: [
              {
                  binding: 0,
                  resource: { buffer: this.attractorBuffer },
              },
              {
                  binding: 1,
                  resource: { buffer: this.lightningNodeBuffer },
              },
              {
                  binding: 2,
                  resource: { buffer: this.lightningStateBuffer },
              },
              {
                  binding: 3,
                  resource: { buffer: this.parameterBuffer },
              },
              {
                  binding: 4,
                  resource: { buffer: this.channelBuffer },
              },
              { binding: 5, resource: { buffer: this.lightningBoltPointBuffer } },
          ],
        });

    }

    private uploadParameters(params: LightningParameters) {
        const data = new ArrayBuffer(64);
        new Float32Array(data).set([
            params.influenceRadius, params.deletionRadius,
            params.stepLength, params.directionWeight,
        ]);
        // WGSL reads this member as u32; do not convert the seed to a float.
        new Uint32Array(data)[4] = params.seed;
        // UI percentages become fractions in WGSL, after the original 32-byte header.
        new Float32Array(data).set([
            params.secondaryMinLengthPercent / 100,
            params.secondaryMaxLengthPercent / 100,
            params.secondaryProbabilityPercent / 100,
            params.tertiaryMinLengthPercent / 100,
            params.tertiaryMaxLengthPercent / 100,
            params.tertiaryProbabilityPercent / 100,
        ], 8);
        renderer.device.queue.writeBuffer(this.parameterBuffer, 0, data);
    }

    private initialNode() {
        const data = new ArrayBuffer(32);
        new Float32Array(data).set([0, 5, 0, 1]);
        new Uint32Array(data)[7] = 1; // parent, channel, depth, valid.
        return data;
    }

    private initialState() {
        // nodeCount, primary status, endpoint distance, maximum depth, branch counts and failures.
        const data = new ArrayBuffer(resultBytes);
        new Uint32Array(data)[0] = 1;
        new Float32Array(data)[2] = 10;
        return data;
    }

    // called when we reset the sim with the new bolt params
    regenerate(params: LightningParameters) {
        if (!Number.isFinite(params.influenceRadius) || params.influenceRadius <= 0 ||
            !Number.isFinite(params.deletionRadius) || params.deletionRadius <= 0 ||
            !Number.isFinite(params.stepLength) || params.stepLength <= 0 ||
            !Number.isFinite(params.directionWeight) || params.directionWeight < 0 || params.directionWeight > 1) {
            throw new Error('Lightning radii and step length must be positive; endpoint weight must be between 0 and 1.');
        }
        if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 0xFFFFFFFF) {
            throw new Error('Lightning seed must be an integer between 0 and 4294967295.');
        }
        for (const [minimum, maximum, probability] of [
            [params.secondaryMinLengthPercent, params.secondaryMaxLengthPercent, params.secondaryProbabilityPercent],
            [params.tertiaryMinLengthPercent, params.tertiaryMaxLengthPercent, params.tertiaryProbabilityPercent],
        ]) {
            if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
                minimum <= 0 || maximum < minimum || maximum > 100 ||
                !Number.isFinite(probability) || probability < 0 || probability > 100) {
                throw new Error('Branch lengths must satisfy 0 < minimum <= maximum <= 100%; probability must be 0–100%.');
            }
        }
        this.uploadParameters(params);
        renderer.device.queue.writeBuffer(this.lightningBoltPointBuffer, 0, new Uint8Array(16 + maxNodes * 16));
        const attractors = generateAttractors([0, 5, 0], [0, -5, 0], 2048, 2.0, params.seed);
        attractors.push({ position: [0, -5, 0], active: true });
        renderer.device.queue.writeBuffer(this.attractorBuffer, 0, packAttractors(attractors));
        renderer.device.queue.writeBuffer(this.lightningNodeBuffer, 0, new Uint8Array(totalNodes * 32));
        renderer.device.queue.writeBuffer(this.lightningNodeBuffer, 0, this.initialNode());
        renderer.device.queue.writeBuffer(this.channelBuffer, 0, new Uint8Array(totalChannels * 64));
        renderer.device.queue.writeBuffer(this.lightningRevealBuffer, 0, new Float32Array(4));
        renderer.device.queue.writeBuffer(this.lightningStateBuffer, 0, this.initialState());
        this.generationId++;
        this.needsGeneration = true;
        this.revealDepth = 0;
        this.revealElapsed = 0;
        Object.assign(this.debugInfo, {
            status: 'Waiting to generate', nodeCount: 1, endpointDistance: 10, generationMs: 0,
            secondaryCount: 0, tertiaryCount: 0, failedBranches: 0,
        });
    }

    destroy() {
        this.generationId++;
        this.needsGeneration = false;
        this.attractorBuffer.destroy();
        this.lightningNodeBuffer.destroy();
        this.lightningBoltPointBuffer.destroy();
        this.lightningStateBuffer.destroy();
        this.parameterBuffer.destroy();
        this.channelBuffer.destroy();
        this.lightningRevealBuffer.destroy();
    }

    compute(encoder: GPUCommandEncoder) {
        if (!this.needsGeneration) {
            return;
        }
        this.needsGeneration = false;
        this.debugInfo.status = 'Generating';
        const startTime = performance.now();
        // Preparation and growth are separate, so another scheduler can interleave them later.
        this.encodePass(encoder, this.lightningPipeline, Math.ceil((maxNodes - 1) / stepsPerDispatch));
        this.encodePass(encoder, this.branchPipelines.prepareSecondary, 1);
        this.encodePass(encoder, this.branchPipelines.growSecondary,
            Math.ceil((lightningLayout.secondaryNodes - 1) / stepsPerDispatch), lightningLayout.secondaryChannels);
        this.encodePass(encoder, this.branchPipelines.prepareTertiary, 1);
        this.encodePass(encoder, this.branchPipelines.growTertiary,
            Math.ceil((lightningLayout.tertiaryNodes - 1) / stepsPerDispatch), lightningLayout.tertiaryChannels);
        this.encodePass(encoder, this.branchPipelines.summarize, 1);

        const buffer = renderer.device.createBuffer({
            label: 'Lightning Generation Result',
            size: resultBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyBufferToBuffer(this.lightningStateBuffer, 0, buffer, 0, resultBytes);
        this.readback = { buffer, generationId: this.generationId, startTime, started: false };
    }

    private encodePass(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, batches: number, channels = 1) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.lightningBindGroup);
        // Each dispatch grows at most 32 nodes. Later dispatches see earlier writes.
        for (let batch = 0; batch < batches; batch++) {
            pass.dispatchWorkgroups(channels);
        }
        pass.end();
    }

    // Call after submitting the encoder containing generation and the result copy.
    afterSubmit() {
        const readback = this.readback;
        if (!readback || readback.started) {
            return;
        }
        readback.started = true;
        void this.readResult(readback);
    }

    private async readResult(readback: NonNullable<LightningGeneration['readback']>) {
        try {
            await readback.buffer.mapAsync(GPUMapMode.READ);
            if (readback.generationId !== this.generationId) {
                return;
            }
            const data = readback.buffer.getMappedRange();
            const integers = new Uint32Array(data);
            const values = new Float32Array(data);
            const status = integers[1];
            this.maximumDepth = integers[3];
            Object.assign(this.debugInfo, {
                nodeCount: integers[0],
                status: status === 1 ? 'Endpoint reached' : status === 2 ? 'Node capacity reached' : 'Generation stopped',
                endpointDistance: values[2],
                secondaryCount: integers[4],
                tertiaryCount: integers[5],
                failedBranches: integers[6],
                // Includes queue/readback latency, rather than GPU-only execution time.
                generationMs: performance.now() - readback.startTime,
            });
        } catch (error) {
            if (readback.generationId === this.generationId) {
                this.debugInfo.status = 'Generation readback failed';
                console.error('Lightning generation result could not be read', error);
            }
        } finally {
            readback.buffer.unmap();
            readback.buffer.destroy();
            if (this.readback === readback) {
                this.readback = undefined;
            }
        }
    }

    updateReveal(deltaTime: number) {
        if (this.needsGeneration || this.debugInfo.status === 'Generating' ||
            this.debugInfo.status === 'Generation readback failed') {
            return;
        }
        this.revealElapsed += Math.max(0, deltaTime) / 1000;
        const progress = this.debugReveal.duration <= 0 ? 1 :
            Math.min(1, this.revealElapsed / this.debugReveal.duration);
        this.revealDepth = Math.floor(this.maximumDepth * progress + 0.000001);
        renderer.device.queue.writeBuffer(this.lightningRevealBuffer, 0, new Float32Array([this.revealDepth, 0, 0, 0]));
    }
}
