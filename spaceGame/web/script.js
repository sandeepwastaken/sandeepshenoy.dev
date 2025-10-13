setInterval(function() {
    document.title = "Space Game";
}, 1);

if (window.innerWidth < 768) {
    const message = encodeURIComponent("This project is not supported on mobile.");
    window.location.href = `https://sandeepshenoy.dev/projects?message=${message}`;
}