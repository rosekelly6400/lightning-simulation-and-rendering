import {AudioHandler} from './sound'
import { Vec3 } from "wgpu-matrix";

export abstract class FDTD {
    // Finite Difference Time Domain Abstract class, 2D and 3D implementations extend off of this. Define template functions/varibales both classes use

    // Shared params
    protected dt: number;
    protected dx: number;
    protected numiters: number; // how many iterations to simulate
    protected adaptiveend: boolean;

    // cpu Grids for simulating
    
    protected solid: Float32Array; // solid field; 0 for air, 1 for medium, TODO: may need to blend between air and solid later on, also has dimx * dimy * dimz

    // TODO: Extra grids for PML
    
    public static rho: number = 1.204; // acoustic medium density, kg / m^3 for air
    public static c: number = 343.2; // speed of sound in air, m/s


    constructor(dx: number= 0.1, dt: number= 0.00206, numiters: number = 1000, adaptive_end=true) {

        // TODO: in constructor, pass in the mesh that defines the boundaries of the city for determining the solid boundary??

        this.dx = dx;
        this.dt = dt; // this should be set in fdtd_2d and 3d to account for dimension using Courant-Friedrichs-Lewy condition for stability
        this.numiters = numiters;
        this.adaptiveend = adaptive_end;
    }

    // getters
    get dtime(): number {
        return this.dt;
    }

    get dspace(): number {
        return this.dx;
    }

    get numiterations(): number {
        return this.numiters;
    }

    protected abstract make_pml(n: number, m: number, R: number): Float32Array; // makes the pml on the CPU. n - layer thickness, in cells m - polynormial order 2-3, R - target reflection

    public abstract start_simulation():  Promise<Float32Array>; // runs the compute shader

    public abstract inject_sound_at(positions: Int32Array, pressures: Float32Array, times: Int32Array): void; // user can input in sounds at certain times per positions and pressures, this will be buffered into the gpu

    public abstract set_solid(micPos: Vec3, lightningPos: Vec3, landHeightData: Float32Array): void;

    public abstract clear_sounds(): void;

    protected abstract write_uniforms(): void;
}