let playlists = [];
let db;
let currentPlaylist = 0;
let playingPlaylist = null; 
let currentSong = null;
let isShuffle = false;
let shuffleOrder = [];
let shuffleIndex = 0;
let playing = false;
let audio = new Audio();

function save() {
    let tx = db.transaction('playlists', 'readwrite');
    let store = tx.objectStore('playlists');
    store.put({id: 1, data: playlists});
}

function renderSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.innerHTML = '<h2>library</h2>' + playlists.map((p, i) => `<p draggable="true" ondragstart="dragPlaylist(event,${i})"><span class="playlist-name" onclick="selectPlaylist(${i})">${currentPlaylist===i && currentSong!==null?'<img src="/portify/sound.svg" style="height:1em;vertical-align:middle;margin-right:6px;">':''}${p.name}</span><img src="/portify/pencil.svg" class="pencil-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"></p>`).join('') + '<button onclick="addPlaylist()">Add Playlist</button>';
    setTimeout(() => {
        document.querySelectorAll('.pencil-icon').forEach(icon => {
            icon.onclick = function(e) {
                e.stopPropagation();
                let idx = parseInt(this.getAttribute('data-idx'));
                let newName = prompt('Rename playlist:', playlists[idx].name);
                if (newName && newName.trim()) {
                    playlists[idx].name = newName.trim();
                    save();
                    renderSidebar();
                    renderPlaylist();
                }
            };
        });
    }, 0);
}

function renderPlaylist() {
    const area = document.querySelector('.playlist-area');
    area.innerHTML = `<div class="playlist-title" style="cursor:pointer;" id="playlist-title">${playlists[currentPlaylist].name}</div>` + playlists[currentPlaylist].songs.map((s, i) => {
        
        const isPlaying = (playingPlaylist === currentPlaylist && currentSong === i);
        return `<div class="song${isPlaying ? ' song-playing':''}" draggable="true" ondragstart="dragSong(event,${i})" onclick="playSong(${i})">${isPlaying ? '<img src="/portify/sound.svg" style="height:1em;vertical-align:middle;margin-right:6px;">':''}${s.name}</div>`;
    }).join('');
    setTimeout(() => {
        const title = document.getElementById('playlist-title');
        if (title) {
            title.onclick = function() {
                let newName = prompt('Rename playlist:', playlists[currentPlaylist].name);
                if (newName && newName.trim()) {
                    playlists[currentPlaylist].name = newName.trim();
                    save();
                    renderSidebar();
                    renderPlaylist();
                }
            };
        }
    }, 0);
}

function addPlaylist() {
    playlists.push({name:'New Playlist',songs:[]});
    save();
    renderSidebar();
}

function selectPlaylist(i) {
    currentPlaylist = i;
    renderPlaylist();
}

function dragSong(e, i) {
    e.dataTransfer.setData('song', i);
}

function dragPlaylist(e, i) {
    e.dataTransfer.setData('playlist', i);
}

document.querySelector('.playlist-area').ondragover = e => e.preventDefault();
document.querySelector('.playlist-area').ondrop = e => {
    let songIdx = e.dataTransfer.getData('song');
    if (songIdx !== '') {
        let song = playlists[currentPlaylist].songs[songIdx];
        playlists[currentPlaylist].songs.splice(songIdx,1);
        playlists[currentPlaylist].songs.push(song);
        save();
        renderPlaylist();
    }
};

document.querySelector('.sidebar').ondragover = e => e.preventDefault();
document.querySelector('.sidebar').ondrop = e => {
    let songIdx = e.dataTransfer.getData('song');
    let playlistIdx = e.dataTransfer.getData('playlist');
    if (songIdx !== '') {
        let song = playlists[currentPlaylist].songs[songIdx];
        playlists[currentPlaylist].songs.splice(songIdx,1);
        let target = Array.from(document.querySelectorAll('.sidebar p')).indexOf(document.elementFromPoint(e.clientX,e.clientY));
        if (target >= 0) playlists[target].songs.push(song);
        save();
        renderSidebar();
        renderPlaylist();
    }
};

document.body.ondragover = e => e.preventDefault();
document.body.ondrop = e => {
    e.preventDefault();
    let files = Array.from(e.dataTransfer.files);
    let added = 0;
    function generateId() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 20; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }
    files.forEach((f, idx) => {
        if (f.type === 'audio/mp3' || f.name.endsWith('.mp3')) {
            let reader = new FileReader();
            reader.onload = function(ev) {
                playlists[currentPlaylist].songs.push({name:f.name,url:ev.target.result,id:generateId()});
                added++;
                if (added === files.filter(x => x.type === 'audio/mp3' || x.name.endsWith('.mp3')).length) {
                    save();
                    renderPlaylist();
                }
            };
            reader.readAsDataURL(f);
        }
    });
};

function playSong(i) {
    currentSong = i;
    playingPlaylist = currentPlaylist;
    audio.src = playlists[currentPlaylist].songs[i].url;
    audio.play();
    playing = true;
    renderPlaylist();
    playBtn.src = 'pause.svg';
    if (isShuffle && shuffleOrder.length) {
        shuffleIndex = shuffleOrder.indexOf(i);
    }
}

const playBtn = document.querySelector('footer img[alt="play"]');
const shuffleBtn = document.querySelector('footer img[alt="shuffle"]');

function updateToggleIcons() {
    if (isShuffle) shuffleBtn.classList.add('active');
    else shuffleBtn.classList.remove('active');
}

playBtn.onclick = () => {
    if (playing) {
        audio.pause();
        playing = false;
        playBtn.src = 'play.svg';
    } else if (currentSong !== null) {
        audio.play();
        playing = true;
        playBtn.src = 'pause.svg';
    }
};
audio.onplay = () => {
    playBtn.src = 'pause.svg';
    playing = true;
};
audio.onpause = () => {
    playBtn.src = 'play.svg';
    playing = false;
};

shuffleBtn.onclick = () => {
    isShuffle = !isShuffle;
    updateToggleIcons();
    if (isShuffle) {
        let n = playlists[currentPlaylist].songs.length;
        shuffleOrder = Array.from({length: n}, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
        }
        shuffleIndex = shuffleOrder.indexOf(currentSong);
    }
};

updateToggleIcons();

audio.onended = () => {
    if (isShuffle) {
        if (!shuffleOrder.length) return;
        shuffleIndex = (shuffleIndex + 1) % shuffleOrder.length;
        if (shuffleIndex === 0) {
            let n = playlists[currentPlaylist].songs.length;
            shuffleOrder = Array.from({length: n}, (_, i) => i);
            for (let i = n - 1; i > 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
            }
            shuffleIndex = 0;
        }
        playSong(shuffleOrder[shuffleIndex]);
    } else {
        if (currentSong < playlists[currentPlaylist].songs.length-1) playSong(currentSong+1);
        else playSong(0);
    }
}

document.onkeydown = e => {
    if (e.key === 'Escape') {
        audio.pause();
        playing = false;
        currentSong = null;
    }
};

function exportData() {
    
    function generateId() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 20; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }
    playlists.forEach(pl => {
        pl.songs.forEach(song => {
            if (!song.id) song.id = generateId();
        });
    });
    let blob = new Blob([JSON.stringify(playlists)],{type:'application/prt'});
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'portify_data.prt';
    a.click();
}

function importData(ev) {
    let file = ev.target.files[0];
    let reader = new FileReader();
    reader.onload = function(e) {
        playlists = JSON.parse(e.target.result);
        
        function generateId() {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let id = '';
            for (let i = 0; i < 20; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return id;
        }
        playlists.forEach(pl => {
            pl.songs.forEach(song => {
                if (!song.id) song.id = generateId();
            });
        });
        save();
        renderSidebar();
        renderPlaylist();
    };
    reader.readAsText(file);
}

window.onload = () => {
    let req = indexedDB.open('portifyDB', 1);
    req.onupgradeneeded = function(e) {
        db = e.target.result;
        db.createObjectStore('playlists', {keyPath: 'id'});
    };
    req.onsuccess = function(e) {
        db = e.target.result;
        let tx = db.transaction('playlists', 'readonly');
        let store = tx.objectStore('playlists');
        let getReq = store.get(1);
        getReq.onsuccess = function(ev) {
            playlists = (ev.target.result && ev.target.result.data) || [{name:'New Playlist',songs:[]}];
            renderSidebar();
            renderPlaylist();
        };
        getReq.onerror = function() {
            playlists = [{name:'New Playlist',songs:[]}];
            renderSidebar();
            renderPlaylist();
        };
    };
    req.onerror = function() {
        playlists = [{name:'New Playlist',songs:[]}];
        renderSidebar();
        renderPlaylist();
    };

    document.querySelector('footer img[alt="skip-back"]').onclick = () => {
        if (isShuffle) {
            if (!shuffleOrder.length) return;
            shuffleIndex = (shuffleIndex - 1 + shuffleOrder.length) % shuffleOrder.length;
            playSong(shuffleOrder[shuffleIndex]);
        } else {
            if (currentSong > 0) playSong(currentSong-1);
            else playSong(playlists[currentPlaylist].songs.length-1);
        }
    };
    document.querySelector('footer img[alt="skip-forward"]').onclick = () => {
        if (isShuffle) {
            if (!shuffleOrder.length) return;
            shuffleIndex = (shuffleIndex + 1) % shuffleOrder.length;
            if (shuffleIndex === 0) {
                let n = playlists[currentPlaylist].songs.length;
                shuffleOrder = Array.from({length: n}, (_, i) => i);
                for (let i = n - 1; i > 0; i--) {
                    let j = Math.floor(Math.random() * (i + 1));
                    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
                }
                shuffleIndex = 0;
            }
            playSong(shuffleOrder[shuffleIndex]);
        } else {
            if (currentSong < playlists[currentPlaylist].songs.length-1) playSong(currentSong+1);
            else playSong(0);
        }
    };
    let header = document.querySelector('header');
    let controls = document.createElement('div');
    controls.style.float = 'right';
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.gap = '20px';
    controls.style.marginLeft = 'auto';
    controls.style.marginRight = '10px';
    let exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export Data';
    exportBtn.onclick = exportData;
    controls.appendChild(exportBtn);
    let importBtn = document.createElement('button');
    importBtn.textContent = 'Import Data';
    controls.appendChild(importBtn);
    let importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.prt';
    importInput.style.display = 'none';
    importInput.onchange = function(ev) {
        if (confirm('Are you sure you want to override your data?')) {
            importData(ev);
        } else {
            importInput.value = '';
        }
    };
    controls.appendChild(importInput);
    importBtn.onclick = () => importInput.click();
    header.appendChild(controls);

    let bar = document.querySelector('.song-progress-bar');
    let currentTimeEl = bar.querySelector('.song-current');
    let durationEl = bar.querySelector('.song-duration');
    let fill = bar.querySelector('.progress-fill');
    function updateProgress() {
        if (audio.src && !isNaN(audio.duration)) {
            let percent = (audio.currentTime / audio.duration) * 100;
            fill.style.width = percent + '%';
            currentTimeEl.textContent = formatTime(audio.currentTime);
            durationEl.textContent = formatTime(audio.duration);
        } else {
            fill.style.width = '0%';
            currentTimeEl.textContent = '0:00';
            durationEl.textContent = '0:00';
        }
        let np = document.getElementById('now-playing');
        if (np) {
            if (
                currentSong !== null &&
                playingPlaylist !== null &&
                playlists[playingPlaylist] &&
                playlists[playingPlaylist].songs[currentSong]
            ) {
                np.innerHTML = `<img src="/portify/sound.svg" style="height:1em;vertical-align:middle;margin-right:6px;">Now Playing: ${playlists[playingPlaylist].songs[currentSong].name}`;
            } else {
                np.textContent = '';
            }
        }
    }

    bar.querySelector('.progress-line').onclick = function(e) {
        if (audio.src && !isNaN(audio.duration)) {
            let rect = this.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let percent = x / rect.width;
            audio.currentTime = percent * audio.duration;
            updateProgress();
        }
    };

    document.addEventListener('keydown', function(e) {
        if (audio.src && !isNaN(audio.duration)) {
            if (e.key === 'ArrowRight') {
                audio.currentTime = Math.min(audio.currentTime + 5, audio.duration);
                updateProgress();
            } else if (e.key === 'ArrowLeft') {
                audio.currentTime = Math.max(audio.currentTime - 5, 0);
                updateProgress();
            }
        }
    });

    function formatTime(t) {
        t = Math.floor(t);
        let m = Math.floor(t/60);
        let s = t%60;
        return m+':' + (s<10?'0':'')+s;
    }

    audio.ontimeupdate = updateProgress;
    audio.onloadedmetadata = updateProgress;
    audio.onplay = updateProgress;
    audio.onpause = updateProgress;
    setInterval(updateProgress, 500);
    updateProgress();
};
