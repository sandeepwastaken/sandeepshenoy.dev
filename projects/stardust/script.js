// Matrix rotation is AI assisted (due to logisical complexity)

document.addEventListener('DOMContentLoaded', function () {
	var card = document.querySelector('.preview-card');
	if (!card) return;
	var img = card.querySelector('img');
	var rafId = null;
		var shadow = card.querySelector('.preview-shadow');
		var maxRotateX = 12;
		var maxRotateY = 18;
		var maxTranslateZ = 36;

	function matrix3dString(rx, ry, tz) {
		return 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateZ(' + tz + 'px)';
	}

	function initCardHandlers() {
		if (!card) return;

		card.addEventListener('mousemove', function (e) {
			var rect = card.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			var x = (e.clientX - rect.left) / rect.width - 0.5;
			var y = (e.clientY - rect.top) / rect.height - 0.5;
			if (!Number.isFinite(x) || !Number.isFinite(y)) return;
			var ry = x * maxRotateY;
			var rx = -y * maxRotateX;
			var d = Math.min(1, Math.hypot(x, y));
			var tz = maxTranslateZ * (1 - d * 0.9);
			if (rafId) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(function () {
				img.style.transition = 'transform 120ms cubic-bezier(.2,.9,.2,1), box-shadow 180ms ease';
				img.style.transform = matrix3dString(rx, ry, tz);
				img.style.boxShadow = '0 34px 60px -18px rgba(7,6,15,0.75), 0 8px 30px -10px rgba(90,58,169,0.12)';
				if (shadow) {
					var sx = Math.min(1.2, 1 + Math.abs(ry) / 40 + Math.abs(rx) / 80);
					var sy = Math.max(0.6, 1 - Math.abs(rx) / 60);
					var tx = (ry / maxRotateY) * 12;
					var ty = Math.max(-6, (rx / maxRotateX) * 10);
					var opacity = 0.85 - (Math.min(1, Math.hypot(rx / maxRotateX, ry / maxRotateY)) * 0.45);
					shadow.style.transform = 'translate3d(' + tx + 'px, ' + ty + 'px, 0) scale(' + sx + ',' + sy + ')';
					shadow.style.opacity = opacity;
				}
			});
		});

		card.addEventListener('mouseleave', function () {
			if (rafId) cancelAnimationFrame(rafId);
			img.style.transition = 'transform 420ms cubic-bezier(.2,.9,.2,1), box-shadow 420ms cubic-bezier(.2,.9,.2,1)';
			img.style.transform = '';
			img.style.boxShadow = '';
			if (shadow) {
				shadow.style.transition = 'transform 420ms cubic-bezier(.2,.9,.2,1), opacity 320ms ease';
				shadow.style.transform = '';
				shadow.style.opacity = '';
			}
		});

		card.addEventListener('touchstart', function () { img.style.transform = ''; img.style.boxShadow = ''; });
	}

	if (img) {
		if (img.complete && img.naturalWidth) {
			initCardHandlers();
		} else {
			img.addEventListener('load', function onLoad() {
				img.removeEventListener('load', onLoad);
				initCardHandlers();
			});
			img.addEventListener('error', function onError() {
				img.removeEventListener('error', onError);
				setTimeout(initCardHandlers, 50);
			});
		}
	} else {
		initCardHandlers();
	}
});

;(function(){
	function qsel(id){return document.getElementById(id)}
	var peopleInput = qsel('peopleInput');
	var budgetInput = qsel('budgetInput');
	var weightInput = qsel('weightInput');
	var reqList = qsel('requirementsList');
	var launchBtn = qsel('launchBtn');

	function getValOrDefault(input, def){
		if(!input) return def;
		var v = input.value === '' || input.value == null ? null : Number(input.value);
		return (v === null || Number.isNaN(v)) ? def : v;
	}

	(function prefillFromParams(){
		try{
			var sp = (location.search||'').replace(/^\?/,'');
			if(!sp) return;
			var params = {};
			sp.split('&').forEach(function(pair){ if(!pair) return; var kv = pair.split('='); try{ params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); }catch(e){} });
			if(params.people && peopleInput){ var n = Number(params.people); if(!isNaN(n)) { peopleInput.value = String(Math.max(1, Math.floor(n))); window.__stardust_people = Math.max(1, Math.floor(n)); } }
			if(params.budget && budgetInput){ var b = Number(params.budget); if(!isNaN(b)) { budgetInput.value = String(Math.max(0, Math.floor(b))); } }
			if(params.weight && weightInput){ var w = Number(params.weight); if(!isNaN(w)) { weightInput.value = String(Math.max(0, Math.floor(w))); } }
		}catch(e){ }
	})();

	function computeRequirements(people, budget, weightLimit){
		var p = Math.max(1, Math.floor(people));
		var farm = p;
		var filtration = p;
		var mattress = p;
		var toilets = Math.ceil(p / 2);
		var weights = Math.ceil(p / 2);
		var canisters = p * 4;
		var rooms = Math.floor(p / 2);
		var stove = 1;
		var computer = 1;
		var radar = 1;
		var blocksPlaced = Math.floor(weightLimit / 180);
		return {
			people: p,
			budget: budget,
			weightLimit: weightLimit,
			farm, filtration, mattress, toilets, weights, canisters, rooms, stove, computer, radar, blocksPlaced
		};
	}

	function renderRequirements(obj){
		if(!reqList) return;
		reqList.innerHTML = '';
		var entries = [
			['People', obj.people],
			['Budget', obj.budget],
			['Weight limit', obj.weightLimit],
			['Farm', obj.farm],
			['Filtration', obj.filtration],
			['Mattress', obj.mattress],
			['Toilets', obj.toilets],
			['Weights', obj.weights],
			['Canisters', obj.canisters],
			['Rooms', obj.rooms],
			['Stove', obj.stove],
			['Computer', obj.computer],
			['Radar', obj.radar],
			['Blocks placed', obj.blocksPlaced]
		];
		entries.forEach(function(e){
			var li = document.createElement('li');
			li.textContent = e[0] + ': ' + e[1];
			reqList.appendChild(li);
		});
	}

	function updatePreview(){
		var people = getValOrDefault(peopleInput, 5);
		var budget = getValOrDefault(budgetInput, 125000);
		var weight = getValOrDefault(weightInput, 450000);
		var req = computeRequirements(people, budget, weight);
		renderRequirements(req);
		return req;
	}

	if(peopleInput) peopleInput.addEventListener('input', updatePreview);
	if(budgetInput) budgetInput.addEventListener('input', updatePreview);
	if(weightInput) weightInput.addEventListener('input', updatePreview);

	updatePreview();

	if(launchBtn){
		launchBtn.addEventListener('click', function(){
			var req = updatePreview();
			var params = new URLSearchParams();
			params.set('people', req.people);
			params.set('budget', req.budget);
			params.set('weight', req.weightLimit);
			var url = 'build/index.html?' + params.toString();
			window.location.href = url;
		});
	}
})();
