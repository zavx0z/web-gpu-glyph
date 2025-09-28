@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  // Точка в центре экрана
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
