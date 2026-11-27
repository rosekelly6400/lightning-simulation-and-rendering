import triangleVertRaw from './triangle.vert.wgsl';
import fragRaw from './red.frag.wgsl';
import volumetricVertRaw from './volumetric.vert.wgsl';
import volumetricFragRaw from './volumetric.frag.wgsl';
import cloudComputeRaw from './cloud_computation.cs.wgsl';
import landComputeRaw from './land_computation.cs.wgsl';
import landVertRaw from './land.vert.wgsl';
import landFragRaw from './land.frag.wgsl';


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
    //const generator = new Function('constants', 'return `' + raw.split('${').join('${constants.') + '`');
    const generator = new Function('constants', 'return `' + raw.replaceAll('${', '${constants.') + '`');
    return generator(constants);
}

export const triangleVertWGSL: string = evalShaderRaw(triangleVertRaw);
export const fragWGSL: string = evalShaderRaw(fragRaw);
export const volumetricVertWGSL: string = evalShaderRaw(volumetricVertRaw);
export const volumetricFragWGSL: string = evalShaderRaw(volumetricFragRaw);
export const cloudComputeSrc: string = evalShaderRaw(cloudComputeRaw);
export const landComputeSrc: string = evalShaderRaw(landComputeRaw);
export const landVertWGSL: string = evalShaderRaw(landVertRaw);
export const landFragWGSL: string = evalShaderRaw(landFragRaw);
