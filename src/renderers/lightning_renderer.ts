import * as renderer from '../renderer';
import { Stage } from '../stage/stage';
import { LightningGeneration, addLightningBolt, removeLightningBolt } from '../lightning/lightning_generation';
import { Pane } from 'tweakpane';
import { FolderApi } from '@tweakpane/core';
import lightningVertexShader from '../shaders/lightning.vert.wgsl';
import lightningFragmentShader from '../shaders/lightning.frag.wgsl';

export class lightningRenderer extends renderer.Renderer {

    private stage: Stage;
    lightningDrawing: LightningDrawing;

    constructor(stage: Stage) {
        super(stage);

        this.stage = stage;
        this.lightningDrawing = new LightningDrawing(stage, stage.lightning);
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

        for (const bolt of this.stage.lightningBolts) {
            bolt.compute(encoder);
            bolt.updateReveal(this.dt);
        }

        const renderPass = encoder.beginRenderPass(renderPassDescriptor);
        this.lightningDrawing.render(renderPass);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
        for (const bolt of this.stage.lightningBolts) bolt.afterSubmit();
    }
}

// Shared drawing setup for the lightning only and combined renderers
export class LightningDrawing {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;
    boltPipeline: GPURenderPipeline;
    lightningDrawBindGroup: GPUBindGroup;
    private generation: LightningGeneration;
    private stage: Stage;
    private lightningDrawLayout: GPUBindGroupLayout;
    private boltBindGroups = new Map<LightningGeneration, GPUBindGroup>();

    constructor(stage: Stage, generation: LightningGeneration) {
        this.generation = generation;
        this.stage = stage;

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

        // 3) create the pipeline
        const lightningDrawLayout = this.lightningDrawLayout = renderer.device.createBindGroupLayout({
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
                {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        this.lightningDrawBindGroup = this.createBoltBindGroup(generation);
        this.boltBindGroups.set(generation, this.lightningDrawBindGroup);

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
                entryPoint: 'main',
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{ format: renderer.canvasFormat }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
    }

    private createBoltBindGroup(generation: LightningGeneration) {
        return renderer.device.createBindGroup({
            label: 'Lightning Drawing Data',
            layout: this.lightningDrawLayout,
            entries: [
                {
                    binding: 1,
                    resource: { buffer: generation.lightningNodeBuffer },
                },
                {
                    binding: 2,
                    resource: { buffer: generation.lightningStateBuffer },
                },
                {
                    binding: 3,
                    resource: { buffer: generation.lightningRevealBuffer },
                },
            ],
        });
    }

    addControls(pane: Pane | FolderApi) {
        const selection = { bolt: this.stage.lightningBolts.indexOf(this.generation) };
        let selector: ReturnType<typeof pane.addInput>;
        let controls: FolderApi;
        const showControls = () => {
            controls?.dispose();
            this.generation = this.stage.lightningBolts[selection.bolt];
            controls = pane.addFolder({ title: 'Selected bolt', expanded: true });
            this.addBoltControls(controls);
        };
        const rebuild = () => {
            selector?.dispose();
            const options = Object.fromEntries(this.stage.lightningBolts.map((_, i) => [`Bolt ${i + 1}`, i]));
            selector = pane.addInput(selection, 'bolt', { label: 'Edit bolt', options });
            selector.on('change', showControls);
            showControls();
        };
        pane.addButton({ title: 'Add bolt' }).on('click', () => {
            try {
                addLightningBolt(this.stage, this.generation);
                selection.bolt = this.stage.lightningBolts.length - 1;
                rebuild();
            } catch (error) {
                this.generation.debugInfo.status = error instanceof Error ? error.message : 'Could not add bolt';
            }
        });
        pane.addButton({ title: 'Remove selected bolt (keep at least one)' }).on('click', () => {
            this.boltBindGroups.delete(this.generation);
            removeLightningBolt(this.stage, this.generation);
            selection.bolt = Math.min(selection.bolt, this.stage.lightningBolts.length - 1);
            rebuild();
        });
        pane.addButton({ title: 'Regenerate all bolts' }).on('click', () => {
            for (const bolt of this.stage.lightningBolts) {
                try {
                    bolt.regenerate(bolt.params);
                } catch (error) {
                    bolt.debugInfo.status = error instanceof Error ? error.message : 'Invalid lightning settings';
                }
            }
        });
        rebuild();
    }

    private addBoltControls(pane: Pane | FolderApi) {

        pane.addButton({ title: 'Set start and end points' }).on('click', () => {
            placement.expanded = !placement.expanded;
        });
        const placement = pane.addFolder({ title: 'World positions', expanded: false });
        placement.addInput(this.generation, 'startPoint', { label: 'Start', x: { step: 0.1 }, y: { step: 0.1 }, z: { step: 0.1 } });
        placement.addInput(this.generation, 'endPoint', { label: 'End', x: { step: 0.1 }, y: { step: 0.1 }, z: { step: 0.1 } });
        const regenerate = () => {
            try {
                this.generation.regenerate(this.generation.params);
            } catch (error) {
                this.generation.debugInfo.status = error instanceof Error ? error.message : 'Invalid lightning settings';
            }
        };
        const seedInput = pane.addInput(this.generation.params, 'seed', {
            label: 'Seed', min: 0, max: 4294967295, step: 1,
        });
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
        const params = this.generation.params;
        const secondary = pane.addFolder({ title: 'Secondary branches', expanded: false });
        const secondaryMinimum = secondary.addInput(params, 'secondaryMinLengthPercent', {
            label: 'Min length %', min: 1, max: 100, step: 1,
        });
        const secondaryMaximum = secondary.addInput(params, 'secondaryMaxLengthPercent', {
            label: 'Max length %', min: 1, max: 100, step: 1,
        });
        secondary.addInput(params, 'secondaryProbabilityPercent', {
            label: 'Probability %', min: 0, max: 100, step: 1,
        });
        secondaryMinimum.on('change', () => {
            if (params.secondaryMinLengthPercent > params.secondaryMaxLengthPercent) {
                params.secondaryMaxLengthPercent = params.secondaryMinLengthPercent;
                secondaryMaximum.refresh();
            }
        });
        secondaryMaximum.on('change', () => {
            if (params.secondaryMaxLengthPercent < params.secondaryMinLengthPercent) {
                params.secondaryMinLengthPercent = params.secondaryMaxLengthPercent;
                secondaryMinimum.refresh();
            }
        });

        const tertiary = pane.addFolder({ title: 'Tertiary branches', expanded: false });
        const tertiaryMinimum = tertiary.addInput(params, 'tertiaryMinLengthPercent', {
            label: 'Min length %', min: 1, max: 100, step: 1,
        });
        const tertiaryMaximum = tertiary.addInput(params, 'tertiaryMaxLengthPercent', {
            label: 'Max length %', min: 1, max: 100, step: 1,
        });
        tertiary.addInput(params, 'tertiaryProbabilityPercent', {
            label: 'Probability %', min: 0, max: 100, step: 1,
        });
        tertiaryMinimum.on('change', () => {
            if (params.tertiaryMinLengthPercent > params.tertiaryMaxLengthPercent) {
                params.tertiaryMaxLengthPercent = params.tertiaryMinLengthPercent;
                tertiaryMaximum.refresh();
            }
        });
        tertiaryMaximum.on('change', () => {
            if (params.tertiaryMaxLengthPercent < params.tertiaryMinLengthPercent) {
                params.tertiaryMinLengthPercent = params.tertiaryMaxLengthPercent;
                tertiaryMinimum.refresh();
            }
        });
        pane.addButton({ title: 'Regenerate Bolt (apply settings)' })
            .on('click', regenerate);
        pane.addButton({ title: 'New random seed + regenerate' }).on('click', () => {
            this.generation.params.seed = crypto.getRandomValues(new Uint32Array(1))[0];
            regenerate();
            seedInput.refresh();
        });
        pane.addInput(this.generation.reveal, 'duration', {
            label: 'Debug reveal (s)', min: 0, max: 10, step: 0.1,
        });
        pane.addMonitor(this.generation.debugInfo, 'status', { label: 'Generation' });
        pane.addMonitor(this.generation.debugInfo, 'nodeCount', { label: 'Nodes' });
        pane.addMonitor(this.generation.debugInfo, 'endpointDistance', { label: 'End distance' });
        pane.addMonitor(this.generation.debugInfo, 'generationMs', { label: 'Generation ms' });
        pane.addMonitor(this.generation.debugInfo, 'secondaryCount', { label: 'Secondary' });
        pane.addMonitor(this.generation.debugInfo, 'tertiaryCount', { label: 'Tertiary' });
        pane.addMonitor(this.generation.debugInfo, 'failedBranches', { label: 'Failed branches' });
    }

    render(renderPass: GPURenderPassEncoder) {
        renderPass.setBindGroup(0, this.sceneUniformsBindGroup);
        renderPass.setPipeline(this.boltPipeline);
        for (const bolt of this.stage.lightningBolts) {
            let bindGroup = this.boltBindGroups.get(bolt);
            if (!bindGroup) {
                bindGroup = this.createBoltBindGroup(bolt);
                this.boltBindGroups.set(bolt, bindGroup);
            }
            renderPass.setBindGroup(1, bindGroup);
            renderPass.draw(bolt.nodeCapacity * 6);
        }
    }
}
