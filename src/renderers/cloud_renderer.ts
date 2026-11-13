import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class cloudRenderer extends renderer.Renderer {

    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        // 1) create the bind group layout
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // cloud texture set
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.cloud_precomputation.cloudTextureStorageBuffer }
                }
            ]
        });

        this.pipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "cloud pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "vert shader",
                    code: shaders.volumetricVertWGSL
                }),
                entryPoint: 'main',
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "frag shader",
                    code: shaders.volumetricFragWGSL,
                }),
                entryPoint: 'main',
                targets: [
                    {
                        format: renderer.canvasFormat,
                    }
                ]
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
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

        const renderPass  = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setPipeline(this.pipeline); 
        renderPass.setBindGroup(shaders.constants.bindGroup_uniforms, this.sceneUniformsBindGroup); // set ur own bind groups

        renderPass.draw(3, 1, 0, 0); // num vertices of the triangle, other data. Will change depending on the data u pass in

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]); // tell it to render on screen
    }
}
