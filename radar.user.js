// ==UserScript==
// @name         GeoGuessr Radar Mobile (StreetView Interceptor)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Intercepta pacotes de rede do Google Street View e mostra o pin exato num mini-mapa flutuante
// @author       DevBernardes
// @match        https://www.geoguessr.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let currentLat = null;
    let currentLng = null;
    let mapInstance = null;
    let markerInstance = null;
    let radarOpen = false;

    // 1. Filtra coordenadas válidas dentro do payload do Google Street View
    function extractCoordsFromText(text) {
        try {
            // Padrão clássico de arrays aninhados da API GeoPhotoService do Google: [null, null, LAT, LNG]
            const regex = /\[\s*null\s*,\s*null\s*,\s*(-?\d+\.\d{4,})\s*,\s*(-?\d+\.\d{4,})\s*\]/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    updateCoordinates(lat, lng);
                    return;
                }
            }
        } catch (e) {}
    }

    function updateCoordinates(lat, lng) {
        currentLat = lat;
        currentLng = lng;
        const badge = document.getElementById('geo-radar-status');
        if (badge) {
            badge.innerText = `🎯 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            badge.style.background = '#059669';
        }
        if (mapInstance && markerInstance) {
            markerInstance.setLatLng([lat, lng]);
            mapInstance.setView([lat, lng], 6);
        }
        // Busca o nome do país/cidade em background (Nominatim gratuito)
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`)
            .then(r => r.json())
            .then(data => {
                const locText = document.getElementById('geo-radar-loc');
                if (locText && data.address) {
                    const city = data.address.city || data.address.town || data.address.state || '';
                    const country = data.address.country || '';
                    locText.innerText = `${country} - ${city}`;
                }
            }).catch(() => {});
    }

    // 2. Intercepta XMLHttpRequest (onde o Street View costuma trafegar os metadados)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (this._url && (
                this._url.includes('GeoPhotoService') ||
                this._url.includes('SingleImageSearch') ||
                this._url.includes('GetMetadata') ||
                this._url.includes('$rpc/google.internal.maps')
            )) {
                extractCoordsFromText(this.responseText);
            }
        });
        return origSend.apply(this, arguments);
    };

    // 3. Intercepta Fetch API (garantia caso o jogo use fetch moderno)
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('GeoPhotoService') || url.includes('SingleImageSearch') || url.includes('GetMetadata') || url.includes('maps.googleapis.com')) {
            const clone = response.clone();
            clone.text().then(text => extractCoordsFromText(text)).catch(() => {});
        }
        return response;
    };

    // 4. Constrói a Interface Flutuante Mobile quando o DOM carregar
    window.addEventListener('DOMContentLoaded', () => {
        // Carrega Leaflet CSS e JS dinamicamente para o mini-mapa
        const leafletCss = document.createElement('link');
        leafletCss.rel = 'stylesheet';
        leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(leafletCss);

        const leafletJs = document.createElement('script');
        leafletJs.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(leafletJs);

        // Cria o botão flutuante (Pílula no topo da tela)
        const hud = document.createElement('div');
        hud.style.cssText = 'position:fixed; top:10px; left:10px; z-index:999999; font-family:sans-serif; user-select:none;';
        hud.innerHTML = `
            <div id="geo-radar-btn" style="background:#0f172a; color:#fff; border:2px solid #10b981; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(0,0,0,0.5); cursor:pointer;">
                <span>🛰️ Radar</span>
                <span id="geo-radar-status" style="background:#334155; padding:2px 8px; border-radius:999px; font-size:11px; font-family:monospace;">Aguardando...</span>
            </div>
            <div id="geo-radar-panel" style="display:none; margin-top:8px; width:280px; background:#0f172a; border:1px solid #334155; border-radius:12px; padding:8px; box-shadow:0 10px 25px rgba(0,0,0,0.8); color:#fff;">
                <div id="geo-radar-loc" style="font-size:13px; font-weight:bold; color:#34d399; margin-bottom:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Localizando país...</div>
                <div id="geo-radar-map" style="height:200px; width:100%; border-radius:8px; background:#1e293b;"></div>
                <div style="display:flex; justify-content:space-between; margin-top:8px; gap:6px;">
                    <button id="geo-zoom-in" style="flex:1; background:#1e293b; color:#38bdf8; border:1px solid #334155; padding:6px; border-radius:6px; font-size:11px; font-weight:bold;">🔍 Zoom Rua</button>
                    <button id="geo-zoom-out" style="flex:1; background:#1e293b; color:#cbd5e1; border:1px solid #334155; padding:6px; border-radius:6px; font-size:11px; font-weight:bold;">🌍 Zoom País</button>
                    <button id="geo-open-gmaps" style="flex:1; background:#059669; color:#fff; border:none; padding:6px; border-radius:6px; font-size:11px; font-weight:bold;">Maps ↗</button>
                </div>
            </div>
        `;
        document.body.appendChild(hud);

        // Ação de abrir/fechar o mini-mapa ao tocar na pílula
        document.getElementById('geo-radar-btn').addEventListener('click', () => {
            const panel = document.getElementById('geo-radar-panel');
            radarOpen = !radarOpen;
            panel.style.display = radarOpen ? 'block' : 'none';

            if (radarOpen && window.L) {
                if (!mapInstance) {
                    mapInstance = window.L.map('geo-radar-map', { zoomControl: false }).setView([currentLat || 0, currentLng || 0], currentLat ? 6 : 2);
                    window.L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20 }).addTo(mapInstance);
                    markerInstance = window.L.marker([currentLat || 0, currentLng || 0]).addTo(mapInstance);
                } else {
                    setTimeout(() => {
                        mapInstance.invalidateSize();
                        if (currentLat) {
                            markerInstance.setLatLng([currentLat, currentLng]);
                            mapInstance.setView([currentLat, currentLng], 6);
                        }
                    }, 100);
                }
            }
        });

        // Botões de Zoom rápido para cravar 5000 pontos ou disfarçar acertando só a região
        document.getElementById('geo-zoom-in').addEventListener('click', () => {
            if (mapInstance && currentLat) mapInstance.setView([currentLat, currentLng], 15);
        });
        document.getElementById('geo-zoom-out').addEventListener('click', () => {
            if (mapInstance && currentLat) mapInstance.setView([currentLat, currentLng], 5);
        });
        document.getElementById('geo-open-gmaps').addEventListener('click', () => {
            if (currentLat) window.open(`https://www.google.com/maps?q=${currentLat},${currentLng}`, '_blank');
        });
    });
})();
