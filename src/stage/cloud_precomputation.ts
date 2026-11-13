import { vec3 } from "wgpu-matrix";
import { device, canvas } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

export class Cloud_Precomputation {
    private camera: Camera;

    static readonly textureRowSize = 200;
    static readonly totalTextureElements = Cloud_Precomputation.textureRowSize*Cloud_Precomputation.textureRowSize*Cloud_Precomputation.textureRowSize;

    cloudTextureArray = new Float32Array(Cloud_Precomputation.totalTextureElements);
    cloudTextureStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    createCloudTextureComputeBindGroupLayout: GPUBindGroupLayout;
    createCloudTextureComputeBindGroup: GPUBindGroup;
    createCloudTextureComputePipeline: GPUComputePipeline;


    constructor(camera: Camera) {
        this.camera = camera;

        this.cloudTextureStorageBuffer = device.createBuffer({
            label: "cloud texture",
            size: 16 + this.cloudTextureArray.byteLength, 
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.updateCloudTextureSetUniformNumElements();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.createCloudTextureComputeBindGroupLayout = device.createBindGroupLayout({
            label: "cloud texture compute bind group layout",
            entries: [
                { // cloud texture
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

        this.createCloudTextureComputeBindGroup = device.createBindGroup({
            label: "cloud texture compute bind group",
            layout: this.createCloudTextureComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.cloudTextureStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.createCloudTextureComputePipeline = device.createComputePipeline({
            label: "cloud texture compute pipeline",
            layout: device.createPipelineLayout({
                label: "cloud texture compute pipeline layout",
                bindGroupLayouts: [ this.createCloudTextureComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "cloud texture compute shader",
                    code: shaders.cloudComputeSrc
                }),
                entryPoint: "main"
            }
        });

        
    }

    updateCloudTextureSetUniformNumElements() {
        device.queue.writeBuffer(this.cloudTextureStorageBuffer, 0, new Uint32Array([Cloud_Precomputation.totalTextureElements]));
        device.queue.writeBuffer(this.cloudTextureStorageBuffer, 4, new Uint32Array([Cloud_Precomputation.textureRowSize]));
    }

    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.createCloudTextureComputePipeline);

        computePass.setBindGroup(0, this.createCloudTextureComputeBindGroup);

        const workgroupCount = Math.ceil(Cloud_Precomputation.totalTextureElements / shaders.constants.workgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}