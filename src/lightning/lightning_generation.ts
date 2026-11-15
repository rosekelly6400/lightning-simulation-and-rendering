import * as renderer from '../renderer';
import lightningShader from '../shaders/lightning.wgsl';

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
  radius: number
): Attractor[] {
  const attractors: Attractor[] = [];

  for (let i = 0; i < pointCount; i++) {
    const t = Math.random();
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());

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
  attractors: Attractor[]
): GPUBuffer {
  const data = packAttractors(attractors);

  const buffer = device.createBuffer({
    label: "Attractors",
    size: data.byteLength,
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
  device: GPUDevice
): GPUComputePipeline {

  const shaderModule = device.createShaderModule({
    label: 'Lightning Growth Shader',
    code: lightningShader,
  });

  const pipeline = device.createComputePipeline({
    label: 'Lightning Growth Pipeline',
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
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
}

export const defaultLightningParameters: LightningParameters = {
    influenceRadius: 0.75,
    deletionRadius: 0.15,
    stepLength: 0.1,
    directionWeight: 0.6,
};

export class LightningGeneration {
    params = { ...defaultLightningParameters };
    private parameterBuffer: GPUBuffer;
    attractorBuffer: GPUBuffer;
    lightningPipeline: GPUComputePipeline;
    lightningBindGroup: GPUBindGroup;

    // actual ligtning bolt node list
    lightningNodeBuffer: GPUBuffer;

    // current nodes for the lightning bolt
    lightningStateBuffer: GPUBuffer;

    constructor() {
      // default start and end point, number of attractors, and radius
        const attractors = generateAttractors(
            [0, 5, 0],
            [0, -5, 0],
            2048,
            2.0
        );

        //adding last pt in attractor list
        attractors.push({
            position: [0, -5, 0],
            active: true,
        });

        this.attractorBuffer = createAttractorBuffer(renderer.device, attractors);
        this.lightningPipeline = createLightningPipeline(renderer.device);
        this.parameterBuffer = renderer.device.createBuffer({
            label: 'Lightning Parameters',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uploadParameters(defaultLightningParameters);
        
        const maxNodes = 512;
        this.lightningNodeBuffer = renderer.device.createBuffer({
            label: 'Lightning Nodes',
            size: maxNodes * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const startPoint = new Float32Array([0, 5, 0, 1]);
        renderer.device.queue.writeBuffer(
          this.lightningNodeBuffer,
          0,
          startPoint
        );

        this.lightningStateBuffer = renderer.device.createBuffer({
          label: 'Lightning State',
          size: 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        renderer.device.queue.writeBuffer(
          this.lightningStateBuffer,
          0,
          new Uint32Array([1])
        );

        this.lightningBindGroup = renderer.device.createBindGroup({
          label: 'Lightning Growth Bind Group',
          layout: this.lightningPipeline.getBindGroupLayout(0),
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
          ],
        });

    }

    private uploadParameters(params: LightningParameters) {
        renderer.device.queue.writeBuffer(this.parameterBuffer, 0, new Float32Array([
            params.influenceRadius, params.deletionRadius,
            params.stepLength, params.directionWeight,
        ]));
    }

    // called when we reset the sim with the new bolt params
    regenerate(params: LightningParameters) {
        this.uploadParameters(params);
        const attractors = generateAttractors([0, 5, 0], [0, -5, 0], 2048, 2.0);
        attractors.push({ position: [0, -5, 0], active: true });
        renderer.device.queue.writeBuffer(this.attractorBuffer, 0, packAttractors(attractors));
        renderer.device.queue.writeBuffer(this.lightningNodeBuffer, 0, new Float32Array([0, 5, 0, 1]));
        renderer.device.queue.writeBuffer(this.lightningStateBuffer, 0, new Uint32Array([1]));
    }

    destroy() {
        this.attractorBuffer.destroy();
        this.lightningNodeBuffer.destroy();
        this.lightningStateBuffer.destroy();
        this.parameterBuffer.destroy();
    }

    compute(encoder: GPUCommandEncoder) {
        const pass = encoder.beginComputePass();

        pass.setPipeline(this.lightningPipeline);
        pass.setBindGroup(0, this.lightningBindGroup);
        pass.dispatchWorkgroups(1);

        pass.end();
    }
}
