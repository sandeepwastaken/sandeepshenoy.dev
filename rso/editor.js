let data = null;

const editor = document.getElementById("editor");
const modal = document.getElementById("modal");

fetch("scioly.json")
  .then(r => r.json())
  .then(json => {
    data = json;
    render();
  })
  .catch(() => {
    data = { events: [], blog: [], results: [], resources: [] };
    render();
  });

function render() {
  editor.innerHTML = "";
  renderSection("events", ["datetime","img","title","description","location"]);
  renderSection("blog", ["datetime","title","author","content"], true);
  renderSection("results", ["datetime","event","location","rawdata"]);
  renderSection("resources", ["title","link","icon","header","description"]);
}

function renderSection(name, fields, isMarkdown = false) {
  const section = document.createElement("div");
  section.className = "section";
  section.innerHTML = `<h2>${name}</h2>`;

  data[name].forEach((item, index) => {
    const entry = document.createElement("div");
    entry.className = "entry";

    fields.forEach(f => {
      const el = f === "content" || f === "rawdata"
        ? document.createElement("textarea")
        : document.createElement("input");

      el.value = item[f] || "";
      el.placeholder = f;
      el.oninput = () => item[f] = el.value;
      entry.appendChild(el);
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      data[name].splice(index, 1);
      render();
    };

    entry.appendChild(del);
    section.appendChild(entry);
  });

  const add = document.createElement("button");
  add.textContent = `Add ${name}`;
  add.onclick = () => {
    const obj = {};
    fields.forEach(f => obj[f] = "");
    if (fields.includes("datetime")) obj.datetime = Math.floor(Date.now()/1000);
    data[name].push(obj);
    render();
  };

  section.appendChild(add);
  editor.appendChild(section);
}

document.getElementById("pushBtn").onclick = () => modal.classList.remove("hidden");
document.getElementById("cancelPush").onclick = () => modal.classList.add("hidden");

document.getElementById("confirmPush").onclick = () => {
  fetch("save.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(() => {
    modal.classList.add("hidden");
    alert("Changes pushed and archived.");
  });
};
