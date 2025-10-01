struct Params {
    unitsPerEm: f32,
    fontSizePx: f32,
    originPx: vec2<f32>,
    canvasWH: vec2<f32>,
};
  
  @group(0) @binding(0) var<uniform> u: Params;
  
struct VSIn {
    @location(0) pos_fu: vec2<f32>,
};
  
struct VSOut {
    @builtin(position) pos: vec4<f32>,
};
  
  @vertex
fn vs_point(v: VSIn) -> VSOut {
    let scale = u.fontSizePx / u.unitsPerEm;
  
    // font units -> pixels (TTF Y↑ → экран Y↓)
    let x_px = u.originPx.x + v.pos_fu.x * scale;
    let y_px = u.originPx.y - v.pos_fu.y * scale;
  
    // pixels -> clip
    let x = ((x_px + 0.5) / u.canvasWH.x) * 2.0 - 1.0;
    let y = 1.0 - ((y_px + 0.5) / u.canvasWH.y) * 2.0;

    var out: VSOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}
  
  @fragment
fn fs_point() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}