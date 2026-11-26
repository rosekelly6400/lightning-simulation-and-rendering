import { Camera } from "./camera";
import { Cloud_Precomputation } from './cloud_precomputation';
import { LightningGeneration } from '../lightning/lightning_generation';

export class Stage {
    //TODO: add clouds lightning and sound here eventualy
    camera: Camera;
    cloud_precomputation: Cloud_Precomputation;
    lightning: LightningGeneration;

    readonly lightningBolts: LightningGeneration[];

    constructor(camera: Camera, cloud_precomputation: Cloud_Precomputation, lightning: LightningGeneration) {
        this.camera = camera;
        this.cloud_precomputation = cloud_precomputation;
        this.lightning = lightning;
        this.lightningBolts = [lightning];
    }
}
