import { Camera } from "./camera";
import { Cloud_Precomputation } from './cloud_precomputation';
import { LightGrid_Precomputation } from './lightGrid_precomputation';
import { LightningGeneration } from '../lightning/lightning_generation';

export class Stage {
    //TODO: add clouds lightning and sound here eventualy
    camera: Camera;
    cloud_precomputation: Cloud_Precomputation;
    lightGrid_precomputation: LightGrid_Precomputation;
    lightning: LightningGeneration;


    constructor(camera: Camera, cloud_precomputation: Cloud_Precomputation, lightGrid_precomputation: LightGrid_Precomputation, lightning: LightningGeneration) {
        this.camera = camera;
        this.cloud_precomputation = cloud_precomputation;
        this.lightGrid_precomputation = lightGrid_precomputation;
        this.lightning = lightning;
    }
}
