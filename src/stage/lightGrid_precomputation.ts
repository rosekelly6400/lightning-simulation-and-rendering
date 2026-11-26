import { vec3 } from "wgpu-matrix";
import { device, canvas } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";
import { Cloud_Precomputation } from './cloud_precomputation';

export class LightGrid_Precomputation {
    private camera: Camera;
    private cloud_precomputation: Cloud_Precomputation;

    static readonly textureRowSize = 200;
    static readonly totalTextureElements = LightGrid_Precomputation.textureRowSize*LightGrid_Precomputation.textureRowSize*LightGrid_Precomputation.textureRowSize;

    lightGridTextureArray = new Float32Array(LightGrid_Precomputation.totalTextureElements);
    lightGridTextureStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    createLightGridTextureComputeBindGroupLayout: GPUBindGroupLayout;
    createLightGridTextureComputeBindGroup: GPUBindGroup;
    createLightGridTextureComputePipeline: GPUComputePipeline;


    constructor(camera: Camera, cloud_precomputation: Cloud_Precomputation) {
        this.camera = camera;
        this.cloud_precomputation = cloud_precomputation;

        this.lightGridTextureStorageBuffer = device.createBuffer({
            label: "lightGrid texture",
            size: 16 + this.lightGridTextureArray.byteLength, 
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.updateLightGridTextureSetUniformNumElements();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.createLightGridTextureComputeBindGroupLayout = device.createBindGroupLayout({
            label: "lightGrid texture compute bind group layout",
            entries: [
                { // lightGrid texture
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // cloud texture set
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.createLightGridTextureComputeBindGroup = device.createBindGroup({
            label: "lightGrid texture compute bind group",
            layout: this.createLightGridTextureComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightGridTextureStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.cloud_precomputation.cloudTextureStorageBuffer }
                }
            ]
        });

        this.createLightGridTextureComputePipeline = device.createComputePipeline({
            label: "lightGrid texture compute pipeline",
            layout: device.createPipelineLayout({
                label: "lightGrid texture compute pipeline layout",
                bindGroupLayouts: [ this.createLightGridTextureComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "lightGrid texture compute shader",
                    code: shaders.lightGridComputeSrc
                }),
                entryPoint: "main"
            }
        });

        
    }

    updateLightGridTextureSetUniformNumElements() {
        device.queue.writeBuffer(this.lightGridTextureStorageBuffer, 0, new Uint32Array([LightGrid_Precomputation.totalTextureElements]));
        device.queue.writeBuffer(this.lightGridTextureStorageBuffer, 4, new Uint32Array([LightGrid_Precomputation.textureRowSize]));
    }

    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.createLightGridTextureComputePipeline);

        computePass.setBindGroup(0, this.createLightGridTextureComputeBindGroup);

        const workgroupCount = Math.ceil(LightGrid_Precomputation.totalTextureElements / shaders.constants.workgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}