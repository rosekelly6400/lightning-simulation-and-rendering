import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import {createPane} from '../renderer';

export class allRenderer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;
    // set your params down here
    params = { clearBlue: 0.3 };

    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        // create the ui and add the inputs
        this.pane = createPane('All Renderer');
        this.pane.addInput(this.params, 'clearBlue', {min: 0, max: 1});

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

        // 2) create the bind group (actually pass in buffer here)
        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                }
            ]
        });

        // 3) create the pipeline. We may need multiple pipeliens like a compute shader one
        this.pipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "all pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "vert shader",
                    code: shaders.triangleVertWGSL
                }),
                entryPoint: 'main',
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "frag shader",
                    code: shaders.fragWGSL,
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
                clearValue: { r: 0.0, g: 0.0, b: this.params.clearBlue, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
                },
            ],
        };

        // if we want to do a computePass we need to initialize a compute pipeline as well, not shown here

        const renderPass  = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setPipeline(this.pipeline); // we have only one render pipelin but there may be more pipelines u wanna put in
        renderPass.setBindGroup(shaders.constants.bindGroup_uniforms, this.sceneUniformsBindGroup); // set ur own bind groups

        renderPass.draw(3, 1, 0, 0); // num vertices of the triangle, other data. Will change depending on the data u pass in

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]); // tell it to render on screen
    }
}
