import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import {ThunderSound, generateDefaultSound, resumeAudio, bufferFromWAV, AudioHandler} from '../sound/sound'
import { FDTD_2D } from '../sound/fdtd_2d';
import { vec3 } from 'wgpu-matrix';
// import { FDTD_3D } from '../sound/fdtd_3d';


export class soundRenderer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    params = { volume: 1.0, distance: 900, humidity: 80 };
    thundersoundlist: ThunderSound[] = [];

    pipeline: GPURenderPipeline;
    fdtd: FDTD_2D;
    // fdtd: FDTD_3D;
    audiohandler: AudioHandler;

    constructor(stage: Stage) {
        super(stage);

        this.fdtd = new FDTD_2D(500, 160, 0.1, 0.00206, 100000);
        // this.fdtd = new FDTD_3D(100, 100, 100, 0.1, 0.00206, 100000);

        this.audiohandler = new AudioHandler(this.fdtd.dtime, this.fdtd.numiterations);

        this.pane = renderer.createPane('Sound Renderer');
        this.pane.addInput(this.params, 'volume', {min: 0, max: 1});
        this.pane.addInput(this.params, 'distance', {min: 0, max: 5000});
        this.pane.addInput(this.params, 'humidity', {min: 0, max: 100});

        this.pane.addButton({title: 'Emit sound'}).on('click', () => this.createThunder()); 

         this.pane.addButton({title: 'simulate'}).on('click', () => this.simulate()); 
        // when we press this button, we want ot creat a thundersound object that will eventually sound depending how far the camera is away from it

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
                label: "sound pipeline layout",
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

    private async createThunder() {
        await resumeAudio();

        // read a wav file for now for audio effects
        //const sound = await bufferFromWAV(new URL('../../media/thundersample.wav', import.meta.url).href);
        const sound = await bufferFromWAV('/media/thundersample.wav');
        const thundersound = new ThunderSound([sound, sound], this.params.distance, this.params.volume);
       this.thundersoundlist.push(thundersound);
    }

    private async updateSpeedofSound() {

        // FDTD_2D.c = this.params.humidity; // figure it out
        return;

    }

    private async simulate() {

        this.fdtd.clear_sounds(); // clear before simulating

        this.fdtd.set_solid(this.camera.cameraPos, vec3.create(0.0,10.0,0.0), this.land.landTextureArray);   // currently hard coding lightning to (0, 10, 0)

        // const positions = new Int32Array([20,20, 20]);
        const positions = new Int32Array([20,20]);

        const pressures = new Float32Array([1000.0]);
        const times = new Int32Array([1]);

        this.fdtd.inject_sound_at(positions, pressures, times);
        // this.fdtd.set_mic_at(90, 90, 90); // top right
        this.fdtd.set_mic_at(90, 90); // top right

        let data: Float32Array = await this.fdtd.start_simulation();
        this.audiohandler.record(data);
        this.audiohandler.save_recording("test");
    }

    override stop() {
        super.stop();
        this.thundersoundlist = [];
    }

    // draw is called in renderer.ts, is overriden depending on which renderer is toggled
    override draw() {
        const dtseconds = this.dt/1000;
        this.thundersoundlist.forEach((thundersound) => {
            thundersound.frame(dtseconds);
        });

        this.thundersoundlist = this.thundersoundlist.filter(thundersound => !thundersound.finished); // keep thundersounds that aren't finished

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

        // if we want to do a computePass we need to initialize a compute pipeline as well, not shown here

        const renderPass  = encoder.beginRenderPass(renderPassDescriptor);

        renderPass.setPipeline(this.pipeline); 
        renderPass.setBindGroup(shaders.constants.bindGroup_uniforms, this.sceneUniformsBindGroup);

        renderPass.draw(3, 1, 0, 0);

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
