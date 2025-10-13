const thumbs = document.querySelectorAll('.thumb');
thumbs.forEach(btn => {
    btn.addEventListener('mousedown', function() {
        btn.classList.add('clicked');
    });
    btn.addEventListener('mouseup', function() {
        btn.classList.remove('clicked');
    });
    btn.addEventListener('mouseleave', function() {
        btn.classList.remove('clicked');
    });
});