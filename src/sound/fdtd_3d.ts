import { Vec3 } from "wgpu-matrix";
import {FDTD} from "./fdtd"
import {device} from "../renderer"
import fdtd_3d from "../shaders/sound/fdtd_3d.cs.wgsl?raw";

export class FDTD_3D extends FDTD {
    // READ: currently doesn't have pml for sake of simplicity adn to have something, but will implement later. padding is reserved for it

    private dimx: number;
    private dimy: number;
    private dimz: number;

    private micposx:number=10;
    private micposy:number=10;
    private micposz:number=10;

    // CPU for sound sources (position, pressure and time, populated in inject_sound_at)
    private maxsources: number; // max number of sound sources we can do
    private numsources: number = 0; // number of ound sources total
    private sources: ArrayBuffer; // list of a struct containing position, pressure, time, 4 bytes each (position.x, position.y, position.z, pressure, time (int)), to be copied into gpu buffer
    private sources_floatcast: Float32Array; // float cast of pospresstime to extract pressure data
    private sources_intcast: Int32Array;  // int cast of pospresstimeto extract positionxy, and time data


    // GPU buffers
    private dev_uniforms: GPUBuffer; // uniforms to be buffered
    private dev_sources: GPUBuffer; // sound source, pos pressure time
    private dev_pressures: GPUBuffer; // pressures vec4 (px, py, pz, p)
    private dev_velocities: GPUBuffer; // velocities vec4 (vx, vy, vz, pad) left bottom face
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
    private compute_latest_ave: GPUComputePipeline;

    // bind groups
    private compute_bindgroup: GPUBindGroup;

    // workgroup stuff
    private readonly wgx: number = 16;
    private readonly wgy: number = 4;
    private readonly wgz: number = 4;

    private readonly injectGroupSize: number = 64;

    // end compute passes per interval so that device isn't lost
    private readonly stepsPerInterval: number = 256;

    constructor(resx:number, resy:number, resz:number,
        dx: number= 0.1, dt: number= 0.00206, numiters: number = 1000, padding:number = 8, maxsrcs: number = 1024)
    {
        // regular constructor stuff
        super(dx, dt, numiters);
        this.dt = Math.min(this.dt, this.dx / (Math.sqrt(3) * FDTD.c));
        // print how the frequencies the signal can represent
        console.log(`dt = ${this.dt.toExponential(3)} s, represents up to ~${(FDTD.c / (2 * this.dx)).toFixed(0)} Hz`);

        this.dimx = resx;
        this.dimy = resy;
        this.dimz = resz;

        this.maxsources = maxsrcs;
        this.solid = new Float32Array(resx * resy * resz); // set to 0 for now

        // 0. create buffers on cpu side

        this.sources = new ArrayBuffer(maxsrcs * 20); // 20 bytes (5 32 bit items for posx, posy, posz, pressure, time)
        this.sources_floatcast = new Float32Array(this.sources);
        this.sources_intcast= new Int32Array(this.sources);

        const pml = this.make_pml(padding);

        // 1. create buffers on the gpu

        // flags
        const storagereadwrite = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

        // device buffer creation
        this.dev_uniforms = device.createBuffer({
            label: "dev uniforms",
            size:48, // 10 elements (4 bytes * 9), with padding of 2 empty elems
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.dev_sources = device.createBuffer({
            label: "dev sources",
            size: this.sources.byteLength,
            usage: storagereadwrite
        });

        this.dev_pressures = device.createBuffer({
            label: "dev pressures", 
            size: this.dimx * this.dimy * this.dimz * 16, // vec4<f32> (px, py, pz, p, px, py, pz, p, ...)
            usage: storagereadwrite
        });

        this.dev_velocities = device.createBuffer({
            label: "dev velocities",
            size: this.dimx * this.dimy * this.dimz * 16, // vec4<f32> 8 bytes in float 32, and each element is a vec4 (vx, vy, vz, _, ...)
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
            label: "fdtd3d bind group",
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

        const module = device.createShaderModule( {label: "fdtd_3d", code:fdtd_3d} );

        const create_pipeline = (entryPoint: string) => device.createComputePipeline({
            label: 'fdtd_3d',
            layout: pipeline_layout,
            compute: { module, entryPoint}
        });
        
        this.compute_inject = create_pipeline("inject_sound_in_grid");
        this.compute_velocity = create_pipeline("update_velocities");
        this.compute_pressure = create_pipeline("update_pressures");
        this.compute_record = create_pipeline("record");
        this.compute_latest_ave = create_pipeline("average_last_samples");
    }

    override write_uniforms(): void {

        const uniforms = new ArrayBuffer(48); // 10 elememts 4 bytes each, 2 blanks element padding
        const uniforms_intcast = new Int32Array(uniforms);
        const uniforms_floatcast = new Float32Array(uniforms);
        const uniforms_uintcast = new Uint32Array(uniforms);

        uniforms_intcast[0] = Math.min(Math.max(this.micposx, 0), this.dimx - 1);
        uniforms_intcast[1] = Math.min(Math.max(this.micposy, 0), this.dimy - 1);
        uniforms_intcast[2] = Math.min(Math.max(this.micposz, 0), this.dimz - 1);
        uniforms_intcast[3] = 0; // padding
        uniforms_intcast[4] = this.dimx;
        uniforms_intcast[5] = this.dimy;
        uniforms_intcast[6] = this.dimz;
        uniforms_floatcast[7] = 1.0 / (FDTD.rho * this.dx);
        uniforms_floatcast[8] = FDTD.rho * FDTD.c ** 2 / this.dx;
        uniforms_uintcast[9] = this.numiters;
        uniforms_uintcast[10] = this.numsources;

        device.queue.writeBuffer(this.dev_uniforms, 0, uniforms);
    }

    // padding at boundaries
    override make_pml(n: number=8, m: number=2, R: number = 1e-4): Float32Array {
        const L = n * this.dx;
        const sigma_max = -(m + 1) * FDTD.c * Math.log(R) / (2 * L); // units: 1/s

        const profile = (pos: number, total: number): number => {
            if (L <= 0) return 0; // no PML
            const d = Math.min(Math.max(Math.max(L - pos, pos - (total - L)), 0), L); // clip

            return sigma_max * (d / L) ** m;
        };

        const coeff_a = (s: number) => (1 - s * this.dt / 2) / (1 + s * this.dt / 2);
        const coeff_b = (s: number) => this.dt / (1 + s * this.dt / 2);
        
        const table = (N: number, offset: number, f: (s: number) => number): Float32Array =>
        Float32Array.from({ length: N }, (_, i) => f(profile((i + offset) * this.dx, N * this.dx)));

        const axis = (N: number) => [
            table(N, 0,   coeff_a), table(N, 0,   coeff_b),   // a_v, b_v
            table(N, 0.5, coeff_a), table(N, 0.5, coeff_b),   // a_p, b_p
        ];
    
        // pack the data [x: a_v b_v a_p b_p, y: a_v b_v a_p b_p, z: a_v b_v a_p b_p]
        const parts = [...axis(this.dimx), ...axis(this.dimy), ...axis(this.dimz)]; // ellipses to insert arrays directly
        const packed = new Float32Array(4 * (this.dimx + this.dimy + this.dimz));
        let o = 0;
        for (const p of parts) 
        { 
            packed.set(p, o); o += p.length; 
        } // append to packed

        return packed;
    }

    override async start_simulation(): Promise<Float32Array> {

        const checkpoint1 = performance.now();


        // write uniforms
        this.write_uniforms();

        // reset 
        const clear = device.createCommandEncoder();
        clear.clearBuffer(this.dev_pressures);
        clear.clearBuffer(this.dev_velocities);
        clear.clearBuffer(this.dev_step);
        clear.clearBuffer(this.dev_recording);
        device.queue.submit([clear.finish()]);

        // work group sizes
        const wgsx = Math.ceil(this.dimx / this.wgx);
        const wgsy = Math.ceil(this.dimy / this.wgy);
        const wgsz = Math.ceil(this.dimz / this.wgz);

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
                computePass.dispatchWorkgroups(wgsx, wgsy, wgsz);

                computePass.setPipeline(this.compute_pressure);
                computePass.dispatchWorkgroups(wgsx, wgsy, wgsz);

                computePass.setPipeline(this.compute_record);
                computePass.dispatchWorkgroups(1); // jsut need one to record and update step counter

                // optionally, compute the average of the past stepsPerInterval, terminate early if < 0
                if (this.adaptiveend) {
                    computePass.setPipeline(this.compute_latest_ave);
                    computePass.dispatchWorkgroups(workGroupSources);
                }

            }
            computePass.end();

            itersleft -= n;

            if (itersleft == 0) {
                // we need encoder to copy over recording data
                encoder.copyBufferToBuffer(this.dev_recording, 0, this.recording, 0, this.numiters * 4);
            }

            device.queue.submit([encoder.finish()]);

        }

        await device.queue.onSubmittedWorkDone(); // for profiling purposes


        const checkpoint3 = performance.now();

        // write to cpu side for recording
        await this.recording.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(this.recording.getMappedRange().slice(0));  // slice copies out
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
        if (positions.length !== 3 * n || times.length !== n) {
            throw new Error("inject_sound_at: need positions.length == 2 * n, and pressures/times of length n");
        }
        if (this.numsources + n > this.maxsources) {
            throw new Error(`inject_sound_at: exceeds maxsources (${this.maxsources})`);
        }

        for (let i = 0; i < n; i++)
        {
            const write_i = (this.numsources + i) * 5;
            // struct is posx, posy, pressure, time
            this.sources_intcast[write_i] = positions[3 * i];
            this.sources_intcast[write_i + 1] = positions[3 * i + 1];
            this.sources_intcast[write_i + 2] = positions[3 * i + 2];

            this.sources_floatcast[write_i + 3] = pressures[i];
            this.sources_intcast[write_i + 4] = times[i];
        }
        this.numsources += n;

        device.queue.writeBuffer(this.dev_sources,  0, this.sources, 0, this.numsources * 20);
    }

    override clear_sounds(): void {
        this.numsources = 0;
    }

    override set_solid(micPos: Vec3, lightningPos: Vec3, landHeightData: Float32Array): void {
        // if (mask.length !== this.solid.length) throw new Error("set_solid: wrong mask size");

        // this.solid.set(mask);
        // device.queue.writeBuffer(this.dev_solids, 0, this.solid);
    }

    public set_mic_at(x:number, y:number, z:number)
    {
        this.micposx = Math.floor(x);
        this.micposy = Math.floor(y);
        this.micposz = Math.floor(z);
    }
}