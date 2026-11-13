import { Camera } from "./camera";
import { Cloud_Precomputation } from './cloud_precomputation';

export class Stage {
    //TODO: add clouds lightning and sound here eventualy
    camera: Camera;
    cloud_precomputation: Cloud_Precomputation;


    constructor(camera: Camera, cloud_precomputation: Cloud_Precomputation) {
        this.camera = camera;
        this.cloud_precomputation = cloud_precomputation;
    }
}
