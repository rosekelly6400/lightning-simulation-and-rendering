struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) lightningPos: vec3f, 
};

struct FragmentOutput
{
    @location(0) color: vec4f
}

@fragment
fn main(in: FragmentInput) -> FragmentOutput {
    var out: FragmentOutput;
    out.color = vec4f(in.lightningPos, 1.0);
    return out;
}
