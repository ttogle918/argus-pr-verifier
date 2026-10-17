// Stub: replaced in a later task.
export function createScene2D(container) {
  container.dataset.testid = 'scene';
  return { update(model) { container.dataset.sceneStage = model.stage; } };
}
