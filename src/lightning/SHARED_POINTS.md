# Shared main-bolt points

Use `stage.lightning.lightningBoltPointBuffer`. This single storage buffer has
a `u32` point count at byte 0, 12 bytes of alignment padding, then ordered
`vec4f` positions starting at byte 16. Positions are in simulation world
coordinates; use `.xyz`. Includes the starting node and main-channel nodes
only, without secondary or tertiary branches.

Cloud and sound shaders can declare it as follows (choose their own binding):

```wgsl
struct LightningBoltPoints {
    count: u32,
    points: array<vec4f>,
};

@group(0) @binding(0)
var<storage, read> boltPoints: LightningBoltPoints;
```

Use a `read-only-storage` buffer entry in the consumer's bind group layout.
Lightning generation binds the same buffer as writable storage to produce it.
Only read `boltPoints.points[i]` for `i < boltPoints.count`. Consecutive points
define segments. `primaryPointCapacity` (512) is capacity, not the valid count.

The final generation pass exports the full main bolt, independent of debug
reveal. Encode consuming passes after `stage.lightning.compute(encoder)`, or
submit them later on the same device queue. No CPU wait is needed for GPU
consumers. Regeneration clears the count and reuses the same buffer, so
consumer bind groups stay valid. This is not an indirect argument buffer.

For JavaScript/Web Audio, copy this buffer to a COPY_DST | MAP_READ staging
buffer, submit, then await mapAsync(READ). Read the count as a u32 at byte 0
and positions as floats starting at byte 16. It cannot be mapped directly.
CPU audio integration is left to the sound implementation.

The generator owns and destroys the buffer; consumers should not destroy it.
