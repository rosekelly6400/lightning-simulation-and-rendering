import * as renderer from '../renderer';
import { Stage } from '../stage/stage';
import { LightningGeneration } from '../lightning/lightning_generation';
import { Pane } from 'tweakpane';
import { FolderApi } from '@tweakpane/core';
import lightningVertexShader from '../shaders/lightning.vert.wgsl';
import lightningFragmentShader from '../shaders/lightning.frag.wgsl';

export class lightningRenderer extends renderer.Renderer {

    lightning: LightningGeneration;
    lightningDrawing: LightningDrawing;

    constructor(stage: Stage) {
        super(stage);

        this.lightning = stage.lightning;
        this.lightningDrawing = new LightningDrawing(stage, this.lightning);
        this.pane = renderer.createPane('Lightning Bolt');
        this.lightningDrawing.addControls(this.pane);
    }

    // draw is called in renderer.ts, is overriden depending on which renderer is toggled
    override draw() {

        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                view: canvasTextureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.3, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
                },
            ],
        };

        this.lightning.compute(encoder);

        const renderPass = encoder.beginRenderPass(renderPassDescriptor);
        this.lightningDrawing.render(renderPass);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}

// Shared drawing setup for the lightning only and combined renderers.
export class LightningDrawing {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;
    boltPipeline: GPURenderPipeline;
    lightningDrawBindGroup: GPUBindGroup;
    private generation: LightningGeneration;

    constructor(stage: Stage, generation: LightningGeneration) {
        this.generation = generation;

        // 1) create the bind group layout
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });

        // 2) create the bind group
        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: stage.camera.uniformsBuffer }
                }
            ]
        });

        // 3) create the pipeline.
        const lightningDrawLayout = renderer.device.createBindGroupLayout({
            label: 'Lightning Drawing Data Layout',
            entries: [
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' },
                },
            ],
        });

        this.lightningDrawBindGroup = renderer.device.createBindGroup({
            label: 'Lightning Drawing Data',
            layout: lightningDrawLayout,
            entries: [
                {
                    binding: 1,
                    resource: { buffer: this.generation.lightningNodeBuffer },
                },
                {
                    binding: 2,
                    resource: { buffer: this.generation.lightningStateBuffer },
                },
            ],
        });

        const drawPipelineLayout = renderer.device.createPipelineLayout({
            bindGroupLayouts: [
                this.sceneUniformsBindGroupLayout,
                lightningDrawLayout,
            ],
        });

        const vertexModule = renderer.device.createShaderModule({
            label: 'Lightning Vertex Shader',
            code: lightningVertexShader,
        });
        const fragmentModule = renderer.device.createShaderModule({
            label: 'Lightning Fragment Shader',
            code: lightningFragmentShader,
        });

        this.boltPipeline = renderer.device.createRenderPipeline({
            label: 'Bolt Drawing Pipeline',
            layout: drawPipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: 'boltVertex',
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'fragmentMain',
                targets: [{ format: renderer.canvasFormat }],
            },
            primitive: {
                topology: 'line-list',
            },
        });
    }

    addControls(pane: Pane | FolderApi) {
        pane.addInput(this.generation.params, 'influenceRadius', {
            label: 'Influence radius', min: 0.1, max: 3, step: 0.05,
        });
        pane.addInput(this.generation.params, 'deletionRadius', {
            label: 'Deletion radius', min: 0.01, max: 1, step: 0.01,
        });
        pane.addInput(this.generation.params, 'stepLength', {
            label: 'Step length', min: 0.01, max: 0.5, step: 0.01,
        });
        pane.addInput(this.generation.params, 'directionWeight', {
            label: 'Endpoint weight', min: 0, max: 1, step: 0.01,
        });
        pane.addButton({ title: 'Regenerate Bolt (apply settings)' })
            .on('click', () => this.generation.regenerate(this.generation.params));
    }

    render(renderPass: GPURenderPassEncoder) {
        renderPass.setBindGroup(0, this.sceneUniformsBindGroup);
        renderPass.setBindGroup(1, this.lightningDrawBindGroup);

        renderPass.setPipeline(this.boltPipeline);
        const nodeCapacity = this.generation.lightningNodeBuffer.size / 16;
        renderPass.draw((nodeCapacity - 1) * 2);
    }
}
