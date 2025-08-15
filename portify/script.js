function showDeleteModal(type, idx) {
    let modal = document.getElementById('delete-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'delete-modal';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.background = 'rgba(0,0,0,0.7)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '9999';
        document.body.appendChild(modal);
    }
    let msg = type === 'playlist' ? 'Do you really want to delete this playlist?' : 'Do you really want to delete this song?';
    modal.innerHTML = `<div style="background:#161b22;padding:2em 2.5em;border-radius:12px;box-shadow:0 0 30px #000;text-align:center;color:#e6edf3;min-width:300px;max-width:90vw;">
        <h3 style='margin-bottom:1em;'>${msg}</h3>
        <button id='delete-yes' style='margin-right:1em;'>Yes</button>
        <button id='delete-no'>No</button>
    </div>`;
    document.getElementById('delete-yes').onclick = function() {
        if (type === 'playlist') {
            if (playlists.length <= 1) {
                alert('You must have at least one playlist.');
                modal.remove();
                return;
            }
            playlists.splice(idx, 1);
            
            if (currentPlaylist === idx) {
                currentPlaylist = Math.min(idx, playlists.length-1);
            } else if (currentPlaylist > idx) {
                currentPlaylist--;
            }
            save();
            renderSidebar();
            renderPlaylist();
        } else if (type === 'song') {
            playlists[currentPlaylist].songs.splice(idx, 1);
            save();
            renderPlaylist();
        }
        modal.remove();
    };
    document.getElementById('delete-no').onclick = function() {
        modal.remove();
    };
}

function exportPlaylist(idx) {
    let pl = playlists[idx];
    let blob = new Blob([JSON.stringify(pl)], {type:'application/prt'});
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pl.name.replace(/[^a-zA-Z0-9_-]/g,'_')}.prts`;
    a.click();
}

function exportSong(playlistIdx, songIdx) {
    let song = playlists[playlistIdx].songs[songIdx];
    let a = document.createElement('a');
    a.href = song.url;
    a.download = song.name.endsWith('.mp3') ? song.name : `${song.name.replace(/[^a-zA-Z0-9_-]/g,'_')}.mp3`;
    a.click();
}
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
    sidebar.innerHTML = '<h2>library</h2>' + playlists.map((p, i) => `<p draggable="true" ondragstart="dragPlaylist(event,${i})"><span class="playlist-name" onclick="selectPlaylist(${i})">${(currentPlaylist===i && currentSong!==null) ? '' : ''}${p.name}</span><img src="/portify/pencil.svg" class="pencil-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"><img src="/portify/delete.svg" class="delete-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"><img src="/portify/download.svg" class="download-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"></p>`).join('') + '<button onclick="addPlaylist()">Add Playlist</button>';
    setTimeout(() => {
        document.querySelectorAll('.delete-icon').forEach(icon => {
            icon.onclick = function(e) {
                e.stopPropagation();
                let idx = parseInt(this.getAttribute('data-idx'));
                showDeleteModal('playlist', idx);
            };
        });
        document.querySelectorAll('.download-icon').forEach(icon => {
            icon.onclick = function(e) {
                e.stopPropagation();
                let idx = parseInt(this.getAttribute('data-idx'));
                exportPlaylist(idx);
            };
        });
    }, 0);
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
    if (!playlists[currentPlaylist].songs.length) {
        area.innerHTML = `<div style="padding:2em;text-align:center;color:#888;font-size:1.2em;">Drag files here to upload songs!</div>`;
    } else {
        area.innerHTML = `<div class="playlist-title" style="cursor:pointer;" id="playlist-title">${playlists[currentPlaylist].name}</div>` + playlists[currentPlaylist].songs.map((s, i) => {
            const isPlaying = (playingPlaylist === currentPlaylist && currentSong === i);
            return `<div class="song${isPlaying ? ' song-playing':''}" draggable="true" ondragstart="dragSong(event,${i})"><span onclick="playSong(${i})">${isPlaying ? '<img src="/portify/sound.svg" style="height:1em;vertical-align:middle;margin-right:6px;">':''}${s.name}</span><img src="/portify/delete.svg" class="song-delete-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"><img src="/portify/download.svg" class="song-download-icon" data-idx="${i}" style="width:16px;height:16px;vertical-align:middle;margin-left:8px;opacity:0.2;filter:invert(1);cursor:pointer;"></div>`;
        }).join('');
    }
    setTimeout(() => {
        document.querySelectorAll('.song-delete-icon').forEach(icon => {
            icon.onclick = function(e) {
                e.stopPropagation();
                let idx = parseInt(this.getAttribute('data-idx'));
                showDeleteModal('song', idx);
            };
        });
        document.querySelectorAll('.song-download-icon').forEach(icon => {
            icon.onclick = function(e) {
                e.stopPropagation();
                let idx = parseInt(this.getAttribute('data-idx'));
                exportSong(currentPlaylist, idx);
            };
        });
    }, 0);
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
        let imported = JSON.parse(e.target.result);
        function generateId() {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let id = '';
            for (let i = 0; i < 20; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return id;
        }
        let importedPlaylists = Array.isArray(imported) ? imported : [imported];
        importedPlaylists.forEach(pl => {
            if (pl.songs && Array.isArray(pl.songs)) {
                pl.songs.forEach(song => {
                    if (!song.id) song.id = generateId();
                });
                playlists.push(pl);
            }
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
    importInput.accept = '.prt,.prts,application/prt';
    importInput.style.display = 'none';
    importInput.onchange = function(ev) {
        if (confirm('Are you sure you want to import this .prt?')) {
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
