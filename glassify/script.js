const inputBox = document.getElementById("inputBox");
const outputStack = document.getElementById("output-stack");
const outputLayers = outputStack.children;

inputBox.addEventListener("input", () => {
  const text = inputBox.value || "Enter text!";
  Array.from(outputLayers).forEach(layer => {
    layer.textContent = text;
  });
});
