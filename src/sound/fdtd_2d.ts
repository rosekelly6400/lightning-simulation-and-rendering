import { Vec3, vec3, Vec2, vec2 } from "wgpu-matrix";
import {FDTD} from "./fdtd"
import {device} from "../renderer"
import fdtd_2d from "../shaders/sound/fdtd_2d.cs.wgsl?raw";

export class FDTD_2D extends FDTD {
    // READ: currently doesn't have pml for sake of simplicity adn to have something, but will implement later. padding is reserved for it

    private dimx: number;
    private dimy: number;

    private padding: number;

    private micposx:number=10;
    private micposy:number=10;

    // CPU for sound sources (position, pressure and time, populated in inject_sound_at)
    private maxsources: number; // max number of sound sources we can do
    private numsources: number = 0; // number of ound sources total
    private sources: ArrayBuffer; // list of a struct containing position, pressure, time, 4 bytes each (position.x, position.y, pressure, time (int)), to be copied into gpu buffer
    private sources_floatcast: Float32Array; // float cast of pospresstime to extract pressure data
    private sources_intcast: Int32Array;  // int cast of pospresstimeto extract positionxy, and time data


    // GPU buffers
    private dev_uniforms: GPUBuffer; // uniforms to be buffered
    private dev_sources: GPUBuffer; // sound source, pos pressure time
    private dev_pressures: GPUBuffer; // pressures vec4 (px, py, p, pad)
    private dev_velocities: GPUBuffer; // velocities vec2 (vx, vy) left bottom face
    private dev_solids: GPUBuffer; // solids, 1 where solid 0 where air, will use waveblender implementation later on to interpolate
    private dev_step: GPUBuffer; // step counter, advanced on gpu, is a vec4 but only uses first element
    private dev_recording: GPUBuffer; // numiters samples for the recording on GPU
    private dev_pml: GPUBuffer; // padding for sound dissipation
    private recording: GPUBuffer; // staging buffer for reading back to CPU

    // compute pipelines
    private compute_inject: GPUComputePipeline;
    private compute_velocity: GPUComputePipeline;
    private compute_pressure: GPUComputePipeline;
    private compute_record: GPUComputePipeline;

    // bind groups
    private compute_bindgroup: GPUBindGroup;

    // workgroup stuff
    private readonly workGroupSize: number = 8;
    private readonly injectGroupSize: number = 64;

    // end compute passes per interval so that device isn't lost
    private readonly stepsPerInterval: number = 256;

    constructor(resx:number, resy:number,
        dx: number= 0.1, dt: number= 0.00206, numiters: number = 1000, padding:number = 8, maxsrcs: number = 1024)
    {
        // regular constructor stuff
        super(dx, dt, numiters);
        this.dt = Math.min(this.dt, this.dx / (Math.sqrt(2) * FDTD.c));
        // print how the frequencies the signal can represent
        console.log(`dt = ${this.dt.toExponential(3)} s, represents up to ~${(FDTD.c / (2 * this.dx)).toFixed(0)} Hz`);

        this.dimx = resx;
        this.dimy = resy;
        this.padding = padding;
        this.maxsources = maxsrcs;
        this.solid = new Float32Array(resx * resy); // set to 0 for now

        // this.audiohandler = new AudioHandler(this.dt, numiters);

        // 0. create buffers on cpu side

        this.sources = new ArrayBuffer(maxsrcs * 16); // 16 bytes (4 32 bit items for posx, posy, pressure, time)
        this.sources_floatcast = new Float32Array(this.sources);
        this.sources_intcast= new Int32Array(this.sources);

        const pml = this.make_pml(padding);


        // 1. create buffers on the gpu

        // flags
        const storagereadwrite = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

        // device buffer creation
        this.dev_uniforms = device.createBuffer({
            label: "dev uniforms",
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.dev_sources = device.createBuffer({
            label: "dev sources",
            size: this.sources.byteLength,
            usage: storagereadwrite
        });

        this.dev_pressures = device.createBuffer({
            label: "dev pressures", 
            size: this.dimx * this.dimy * 16, // vec4<f32> (px, py, p, _, px, py, p, _, ...)
            usage: storagereadwrite
        });

        this.dev_velocities = device.createBuffer({
            label: "dev velocities",
            size: this.dimx * this.dimy * 8, // vec2<f32> 8 bytes in float 32, and each element is a vec2 (vx, vy, vx, vy, ...)
            usage: storagereadwrite
        });

        this.dev_solids = device.createBuffer({
            label: "dev solids",
            size: this.solid.byteLength,
            usage: storagereadwrite
        });

        device.queue.writeBuffer(
            this.dev_solids,
            0,
            this.solid // TODO: cpu buffer, need to populate
        )

        this.dev_step = device.createBuffer({
            label: "dev step",
            size: 16,
            usage: storagereadwrite
        });

        // output of the compute shader, writes into this
        this.dev_recording = device.createBuffer({
            label: "dev recording",
            size: this.numiters * 4, // for float 32
            usage: storagereadwrite
        });

        // staging buffer for the recording
        this.recording = device.createBuffer({
            size: this.numiters * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        this.dev_pml = device.createBuffer({
            label: "dev pml",
            size: pml.byteLength,
            usage: storagereadwrite
        });
        device.queue.writeBuffer(this.dev_pml, 0, pml);


        // 2. initialize layouts
        const bindGroupLayout = device.createBindGroupLayout({
            label: "fdtd2d bind group layout",
            entries: [
                { // regular uniforms
                    binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: "uniform"}
                },
                { // sources - position pressure time struct
                    binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // pressures
                    binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // velocities
                    binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // solid/air
                    binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // recording
                    binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // step counter
                    binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                },
                { // pml
                    binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}
                }
            ]
        });

        // 3. create the bind groups (where we actually attach the gpu buffer data from step 1)
        this.compute_bindgroup = device.createBindGroup({
            label: "fdtd2d bind group",
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: {buffer: this.dev_uniforms}     },
                { binding: 1, resource: {buffer: this.dev_sources}      },
                { binding: 2, resource: {buffer: this.dev_pressures}    },
                { binding: 3, resource: {buffer: this.dev_velocities}   },
                { binding: 4, resource: {buffer: this.dev_solids}       },
                { binding: 5, resource: {buffer: this.dev_recording}    },
                { binding: 6, resource: {buffer: this.dev_step}         },
                { binding: 7, resource: {buffer: this.dev_pml}          },

            ]
        });

        // 4. create the compute pipeline

        const pipeline_layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});

        const module = device.createShaderModule( {label: "fdtd_2d", code:fdtd_2d} );

        const create_pipeline = (entryPoint: string) => device.createComputePipeline({
            label: 'fdtd_2d',
            layout: pipeline_layout,
            compute: { module, entryPoint}
        });
        
        this.compute_inject = create_pipeline("inject_sound_in_grid");
        this.compute_velocity = create_pipeline("update_velocities");
        this.compute_pressure = create_pipeline("update_pressures");
        this.compute_record = create_pipeline("record");
    }

    override write_uniforms(): void {

        const uniforms = new ArrayBuffer(32); // 8 elememts 4 bytes each
        const uniforms_intcast = new Int32Array(uniforms);
        const uniforms_floatcast = new Float32Array(uniforms);
        const uniforms_uintcast = new Uint32Array(uniforms);

        uniforms_intcast[0] = Math.min(Math.max(this.micposx, 0), this.dimx - 1);
        uniforms_intcast[1] = Math.min(Math.max(this.micposy, 0), this.dimy - 1);
        uniforms_intcast[2] = this.dimx;
        uniforms_intcast[3] = this.dimy;
        uniforms_floatcast[4] = 1.0 / (FDTD.rho * this.dx);
        uniforms_floatcast[5] = FDTD.rho * FDTD.c ** 2 / this.dx;
        uniforms_uintcast[6] = this.numiters;
        uniforms_uintcast[7] = this.numsources;

        device.queue.writeBuffer(this.dev_uniforms, 0, uniforms);
    }

    override make_pml(n: number=8, m: number=2, R: number = 1e-4): Float32Array {
        const L = n * this.dx;
        const sigma_max = -(m + 1) * FDTD.c * Math.log(R) / (2 * L); // units: 1/s

        const profile = (pos: number, total: number): number => {
            const d = Math.min(Math.max(Math.max(L - pos, pos - (total - L)), 0), L); // clip

            return sigma_max * (d / L) ** m;
        };

        const coeff_a = (s: number) => (1 - s * this.dt / 2) / (1 + s * this.dt / 2);
        const coeff_b = (s: number) => this.dt / (1 + s * this.dt / 2);
        
        const Lx = this.dimx * this.dx, Ly = this.dimy * this.dx;

        const table = (N: number, total: number, offset: number, f: (s: number) => number): Float32Array =>
        Float32Array.from({ length: N }, (_, i) => f(profile((i + offset) * this.dx, total)));

        const a_vx = table(this.dimx, Lx, 0, coeff_a), b_vx = table(this.dimx, Lx, 0,   coeff_b);
        const a_px = table(this.dimx, Lx, 0.5, coeff_a), b_px = table(this.dimx, Lx, 0.5, coeff_b);
        const a_vy = table(this.dimy, Ly, 0,   coeff_a), b_vy = table(this.dimy, Ly, 0,   coeff_b);
        const a_py = table(this.dimy, Ly, 0.5, coeff_a), b_py = table(this.dimy, Ly, 0.5, coeff_b);

        // pack the data [a_vx, b_vx, a_px, b_px, a_vy, b_vy, a_py, b_py]
        const parts = [a_vx, b_vx, a_px, b_px, a_vy, b_vy, a_py, b_py];
        const packed = new Float32Array(4 * this.dimx + 4 * this.dimy);
        let o = 0;
        for (const p of parts) 
        { 
            packed.set(p, o); o += p.length; 
        } // append to packed

        return packed;
    }

    override async start_simulation(): Promise<Float32Array> {

        const checkpoint1 = performance.now();

        this.write_uniforms();

        // reset 
        const clear = device.createCommandEncoder();
        clear.clearBuffer(this.dev_pressures);
        clear.clearBuffer(this.dev_velocities);
        clear.clearBuffer(this.dev_step);
        clear.clearBuffer(this.dev_recording);
        device.queue.submit([clear.finish()]);

        // wgs
        const workGroupCountX = Math.ceil(this.dimx / this.workGroupSize);
        const workGroupCountY = Math.ceil(this.dimy / this.workGroupSize);
        const workGroupSources = Math.ceil(this.numsources / this.injectGroupSize);

        // simulation loop

        let itersleft = this.numiters;

        const checkpoint2 = performance.now();


        while (itersleft > 0) {
            const n = Math.min(this.stepsPerInterval, itersleft);
            const encoder = device.createCommandEncoder();

            const computePass = encoder.beginComputePass();
            computePass.setBindGroup(0, this.compute_bindgroup);

            for (let i = 0; i < n; i++) {
                // the compute shader execution, call in sound_renderer
                if (this.numsources > 0) {
                    computePass.setPipeline(this.compute_inject);
                    computePass.dispatchWorkgroups(workGroupSources);
                }

                computePass.setPipeline(this.compute_velocity);
                computePass.dispatchWorkgroups(workGroupCountX, workGroupCountY);

                computePass.setPipeline(this.compute_pressure);
                computePass.dispatchWorkgroups(workGroupCountX, workGroupCountY);

                computePass.setPipeline(this.compute_record);
                computePass.dispatchWorkgroups(1); // jsut need one to record and update step counter
            }
            computePass.end();

            itersleft -= n;

            if (itersleft == 0) {
                // we need encoder to copy over recording data
                encoder.copyBufferToBuffer(this.dev_recording, 0, this.recording, 0, this.numiters * 4);
            }

            device.queue.submit([encoder.finish()]);

        }

        await device.queue.onSubmittedWorkDone();


        const checkpoint3 = performance.now();

        
        // write to cpu side for recording
        await this.recording.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(this.recording .getMappedRange().slice(0));  // slice copies out
        this.recording.unmap();

        const checkpoint4 = performance.now();


        console.log("clearing takes ", checkpoint2 - checkpoint1, " ms");
        console.log("loop takes ", checkpoint3 - checkpoint2, " ms");
        console.log("writing back to cpu takes ", checkpoint4 - checkpoint3, " ms"); // this takes a lomg time??

        console.log(data.length, " size");

        return data;
    }
   
    override inject_sound_at(positions: Int32Array, pressures: Float32Array, times: Int32Array): void {

        // error handling
        const n = pressures.length;
        if (positions.length !== 2 * n || times.length !== n) {
            throw new Error("inject_sound_at: need positions.length == 2 * n, and pressures/times of length n");
        }
        if (this.numsources + n > this.maxsources) {
            throw new Error(`inject_sound_at: exceeds maxSources (${this.maxsources})`);
        }

        for (let i = 0; i < n; i++)
        {
            const write_i = (this.numsources + i) * 4;
            // struct is posx, posy, pressure, time
            this.sources_intcast[write_i] = positions[2 * i];
            this.sources_intcast[write_i + 1] = positions[2 * i + 1];
            this.sources_floatcast[write_i + 2] = pressures[i];
            this.sources_intcast[write_i + 3] = times[i];
        }
        this.numsources += n;

        device.queue.writeBuffer(this.dev_sources,  0, this.sources, 0, this.numsources * 16);
    }

    override clear_sounds(): void {
        this.numsources = 0;
    }

    override set_solid(micPos: Vec3, lightningPos: Vec3, landHeightData: Float32Array): void {
        var micToLightningDirXZ = vec3.normalize(vec3.subtract(vec3.create(lightningPos[0], 0.0, lightningPos[2]), vec3.create(micPos[0], 0.0, micPos[2])));
        var micToLightningDirY = vec3.normalize(vec3.subtract(vec3.create( 0.0, lightningPos[1], 0.0), vec3.create(0.0, micPos[1], 0.0)));
        const distanceXZ = vec2.dist(vec2.create(micPos[0], micPos[2]), vec2.create(lightningPos[0], lightningPos[2]));
        const distanceY = Math.abs(lightningPos[1] - micPos[1]);

        const cellWidth = distanceXZ / this.dimx;
        const cellHeight = distanceY / this.dimy;
        const cellSize = this.dx;  // cells are squares so final cell width and height are equal to cellSize

        // fill solids
        var mask = new Float32Array(this.dimx * this.dimy);
        var midpointPos = vec3.mulScalar(vec3.add(micPos, lightningPos), 0.5);  // midpoint between lightning and camera
        // set currentPos to 0,0 index position of grid centered on midpoint (bottom left corner)
        var currentPos = vec3.subtract(midpointPos, vec3.mulScalar(micToLightningDirY, cellSize*this.dimy*0.5));    // subtract half of y grid width
        currentPos = vec3.subtract(currentPos, vec3.mulScalar(micToLightningDirXZ, cellSize*this.dimx*0.5));        // subtract half of x grid width

        // variables for converting xz of currentPos to landTextureArray index
        const landbufferRowLength = Math.floor(Math.sqrt(landHeightData.length)); 
        const originIndex = Math.floor(landbufferRowLength * 0.5)*landbufferRowLength + Math.floor(landbufferRowLength * 0.5);
        const landbufferCellSize = 0.1;     //this is arbitrarily set currently TODO: set based on land buffer size

        var oneCounter = 0;
        for(var y = 0; y < this.dimy; y++) {
            for(var x = 0; x < this.dimx; x++) {
                const currIndex = y * this.dimx + x;

                // set padding rows and cols to 0
                if(y < this.padding || this.dimy - y < this.padding || 
                   x < this.padding || this.dimx - x < this.padding ) {
                    mask[currIndex] = 0.0;
                }
                else {
                    // convert xz of currentPos to landTextureArray index
                    var currPosToIndex = Math.floor((currentPos[0]/landbufferCellSize) + (currentPos[2]/landbufferCellSize)*landbufferRowLength + originIndex);

                    if (currPosToIndex >= 0 && currPosToIndex < landHeightData.length && landHeightData[currPosToIndex] >= currentPos[1]) {
                        mask[currIndex] = 1.0;
                        oneCounter++
                    }
                    else {
                        mask[currIndex] = 0.0;
                    }
                }
                currentPos = vec3.add(currentPos, vec3.mulScalar(micToLightningDirXZ,cellSize));
            }
            currentPos = vec3.add(currentPos, vec3.mulScalar(micToLightningDirY,cellSize));
        }

        if (mask.length !== this.solid.length) throw new Error("set_solid: wrong mask size");

        this.solid.set(mask);
        device.queue.writeBuffer(this.dev_solids, 0, this.solid);
    }

    public set_mic_at(x:number, y:number)
    {
        this.micposx = Math.floor(x);
        this.micposy = Math.floor(y);
    }
}