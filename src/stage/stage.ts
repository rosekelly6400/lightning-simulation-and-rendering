import { Camera } from "./camera";
import { Cloud_Precomputation } from './cloud_precomputation';
import { Land_Precomputation } from './land_precomputation';
import { LightningGeneration } from '../lightning/lightning_generation';

export class Stage {
    //TODO: add clouds lightning and sound here eventualy
    camera: Camera;
    cloud_precomputation: Cloud_Precomputation;
    lightning: LightningGeneration;
    land: Land_Precomputation;


    constructor(camera: Camera, cloud_precomputation: Cloud_Precomputation, lightning: LightningGeneration, land: Land_Precomputation) {
        this.camera = camera;
        this.cloud_precomputation = cloud_precomputation;
        this.lightning = lightning;
        this.land = land;
    }
}
