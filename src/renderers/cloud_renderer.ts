import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { LightningGeneration } from '../lightning/lightning_generation';
import { LightningDrawing } from './lightning_renderer';
import {createPane} from '../renderer';

export class cloudRenderer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    gbufferMatBindGroupLayout: GPUBindGroupLayout;
    gbufferMatBindGroup: GPUBindGroup;

    positionTexture: GPUTexture;
    positionTextureView: GPUTextureView;
    positionTextureSampler: GPUSampler;

    lightning: LightningGeneration;
    lightningDrawing: LightningDrawing;

    params = { clearBlue: 0.3 };

    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        this.pane = createPane('Cloud Renderer');
        this.pane.addInput(this.params, 'clearBlue', {min: 0, max: 1});

        this.lightning = stage.lightning;
        this.lightningDrawing = new LightningDrawing(stage, this.lightning);
        // ui for lightning
        const lightningControls = this.pane.addFolder({title: 'Lightning Bolt'});
        this.lightningDrawing.addControls(lightningControls);

        // LIGHTNING TEXTURE SETUP
        this.positionTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: renderer.canvasFormat,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.positionTextureView = this.positionTexture.createView();
        this.positionTextureSampler = renderer.device.createSampler({
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter: "linear",
            minFilter:"linear",
            mipmapFilter: "linear"
        });

        this.gbufferMatBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "gbuffer material bind group layout",
            entries: [
                { // position 
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // position sampler
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }
            ]
        });

        this.gbufferMatBindGroup = renderer.device.createBindGroup({
            label: "material bind group",
            layout: this.gbufferMatBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.positionTextureView
                },
                {
                    binding: 1,
                    resource: this.positionTextureSampler
                }
            ]
        });

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
                    this.sceneUniformsBindGroupLayout, this.gbufferMatBindGroupLayout
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

        const encoderLightning = renderer.device.createCommandEncoder();
        const canvasTextureViewLightning = renderer.context.getCurrentTexture().createView();

        const renderPassDescriptorLightning: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                view: this.positionTextureView,
                clearValue: { r: 0.0, g: 0.0, b: 1.0, a: 0.0 },
                loadOp: 'clear',
                storeOp: 'store',
                },
            ],
        };

        this.lightning.compute(encoderLightning);
        const renderPassLightning  = encoderLightning.beginRenderPass(renderPassDescriptorLightning);
        this.lightningDrawing.render(renderPassLightning);

        renderPassLightning.end();

        renderer.device.queue.submit([encoderLightning.finish()]); // tell it to render on screen

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
        renderPass.setBindGroup(1, this.gbufferMatBindGroup);

        renderPass.draw(3, 1, 0, 0); // num vertices of the triangle, other data. Will change depending on the data u pass in

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]); // tell it to render on screen
    }
}
