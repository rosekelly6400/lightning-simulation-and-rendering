import triangleVertRaw from './triangle.vert.wgsl';
import fragRaw from './red.frag.wgsl';
import volumetricVertRaw from './volumetric.vert.wgsl';
import volumetricFragRaw from './volumetric.frag.wgsl';
import cloudComputeRaw from './cloud_computation.cs.wgsl';


export const constants = {
    bindGroup_uniforms: 0,
    bindGroup_model: 1,
    bindGroup_material: 2,

    workgroupSize: 128,

    clusterDimX: 32,
    clusterDimY: 18,
    clusterDimZ: 24
};

// replaces ${name} in WGSL with matching value from constants (above)
function evalShaderRaw(raw: string) {
    const generator = new Function('constants', 'return `' + raw.replaceAll('${', '${constants.') + '`');   
    return generator(constants);
}

export const triangleVertWGSL: string = evalShaderRaw(triangleVertRaw);
export const fragWGSL: string = evalShaderRaw(fragRaw);
export const volumetricVertWGSL: string = evalShaderRaw(volumetricVertRaw);
export const volumetricFragWGSL: string = evalShaderRaw(volumetricFragRaw);
export const cloudComputeSrc: string = evalShaderRaw(cloudComputeRaw);