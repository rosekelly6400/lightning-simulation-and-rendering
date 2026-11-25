import { vec3 } from "wgpu-matrix";
import { device, canvas } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

export class Land_Precomputation {
    private camera: Camera;

    static readonly textureRowSize = 2000;
    static readonly totalTextureElements = Land_Precomputation.textureRowSize*Land_Precomputation.textureRowSize;

    landTextureArray = new Float32Array(Land_Precomputation.totalTextureElements);
    landTextureStorageBuffer: GPUBuffer;
    landTextureStagingBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    createLandTextureComputeBindGroupLayout: GPUBindGroupLayout;
    createLandTextureComputeBindGroup: GPUBindGroup;
    createLandTextureComputePipeline: GPUComputePipeline;


    constructor(camera: Camera) {
        this.camera = camera;

        this.landTextureStorageBuffer = device.createBuffer({
            label: "land texture",
            size: 16 + this.landTextureArray.byteLength, 
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        this.updateLandTextureSetUniformNumElements();

        this.landTextureStagingBuffer = device.createBuffer({
            label: "land staging buffer",
            size: this.landTextureArray.byteLength, 
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.createLandTextureComputeBindGroupLayout = device.createBindGroupLayout({
            label: "land texture compute bind group layout",
            entries: [
                { // land texture
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.createLandTextureComputeBindGroup = device.createBindGroup({
            label: "land texture compute bind group",
            layout: this.createLandTextureComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.landTextureStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.createLandTextureComputePipeline = device.createComputePipeline({
            label: "land texture compute pipeline",
            layout: device.createPipelineLayout({
                label: "land texture compute pipeline layout",
                bindGroupLayouts: [ this.createLandTextureComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "land texture compute shader",
                    code: shaders.landComputeSrc
                }),
                entryPoint: "main"
            }
        });

        
    }

    updateLandTextureSetUniformNumElements() {
        device.queue.writeBuffer(this.landTextureStorageBuffer, 0, new Uint32Array([Land_Precomputation.totalTextureElements]));
        device.queue.writeBuffer(this.landTextureStorageBuffer, 4, new Uint32Array([Land_Precomputation.textureRowSize]));
    }

    async calculateLandBuffer(time: number) {
        console.log("Running calculateLandBuffer");
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.createLandTextureComputePipeline);

        computePass.setBindGroup(0, this.createLandTextureComputeBindGroup);

        const workgroupCount = Math.ceil(Land_Precomputation.totalTextureElements / shaders.constants.workgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        encoder.copyBufferToBuffer(this.landTextureStorageBuffer, 16, this.landTextureStagingBuffer, 0, this.landTextureArray.byteLength);

        device.queue.submit([encoder.finish()]);

        // Save land buffer data to CPU
        await this.landTextureStagingBuffer.mapAsync(GPUMapMode.READ);
        const tempLandTextArray = new Float32Array(this.landTextureStagingBuffer.getMappedRange());
        this.landTextureArray = new Float32Array(tempLandTextArray);
        this.landTextureStagingBuffer.unmap();
    }
}