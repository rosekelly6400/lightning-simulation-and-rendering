import { Camera } from './stage/camera';
import { Cloud_Precomputation } from './stage/cloud_precomputation';
import { Stage } from './stage/stage';
import { assert } from './utils/util';
import { Pane } from 'tweakpane';

export var canvas: HTMLCanvasElement;
export var canvasFormat: GPUTextureFormat;
export var context: GPUCanvasContext;
export var device: GPUDevice;
// export var canvasTextureView: GPUTextureView;

export const fovYDegrees = 45;
export async function initWebGPU() {
    if (navigator.gpu === undefined) {
        const h = document.querySelector('#title') as HTMLElement;
        h.innerText = 'WebGPU is not supported in this browser.';
        throw new Error("WebGPU not supported on this browser");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) {
        const h = document.querySelector('#title') as HTMLElement;
        h.innerText = 'No adapter is available for WebGPU.';
        throw new Error("No WebGPU adapter");
    }

    device = await adapter.requestDevice();

    canvas = document.querySelector<HTMLCanvasElement>('#webgpu-canvas');
    assert(canvas !== null);
    const devicePixelRatio = window.devicePixelRatio;

    const resize = () => {
        const dpr = window.devicePixelRatio;
        canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    };
    resize(); 

    new ResizeObserver(resize).observe(canvas);

    context = canvas.getContext('webgpu') as GPUCanvasContext;
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });



    console.log("WebGPU init successsful");
}

export abstract class Renderer {
    protected camera: Camera;
    protected cloud_precomputation: Cloud_Precomputation;

    private prevTime: number = 0;
    private frameRequestId: number;

    constructor(stage: Stage) {
        this.camera = stage.camera;
        this.cloud_precomputation = stage.cloud_precomputation;

        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }

    stop(): void {
        cancelAnimationFrame(this.frameRequestId);
    }

    protected abstract draw(): void;

    private onFrame(time: number) {
        if (this.prevTime == 0) {
            this.prevTime = time;
        }

        let deltaTime = time - this.prevTime;
        this.camera.onFrame(deltaTime);
        this.cloud_precomputation.onFrame(deltaTime);

        this.draw();

        this.prevTime = time;
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }
}
