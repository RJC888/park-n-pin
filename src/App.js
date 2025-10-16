import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Trash2, Settings, ZoomIn, ZoomOut, Camera, Wifi, WifiOff, X } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// 🔥 Firebase Config - REPLACE WITH YOUR VALUES
const firebaseConfig = {
  apiKey: "AIzaSyCJp4p1z004jsQfqWgyTZeIupXS0bCIT9U",
  authDomain: "park-it-pin-it-ad3f8.firebaseapp.com",
  projectId: "park-it-pin-it-ad3f8",
  storageBucket: "park-it-pin-it-ad3f8.firebasestorage.app",
  messagingSenderId: "394346806283",
  appId: "1:394346806283:web:ab2738e3b91fade1185b0e"
};

// 🗺️ Google Maps API Key - REPLACE WITH YOUR VALUE
const GOOGLE_MAPS_API_KEY = "AIzaSyAmocm8FS-rVPESd1W6WjFQ_s9x22dP1Po";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Generate browser-based user ID (no auth needed!)
const getUserId = () => {
  let userId = localStorage.getItem('parkNPinUserId');
  if (!userId) {
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('parkNPinUserId', userId);
  }
  return userId;
};

export default function ParkNPin() {
  const [userId] = useState(getUserId());
  const [currentLocation, setCurrentLocation] = useState(null);
  const [parkingLocation, setParkingLocation] = useState(null);
  const [parkingPhoto, setParkingPhoto] = useState(null);
  const [savedLocations, setSavedLocations] = useState([]);
  const [screen, setScreen] = useState('map');
  const [isAnimating, setIsAnimating] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(13);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showPhotoPrompt, setShowPhotoPrompt] = useState(false);
  const [showFullPhoto, setShowFullPhoto] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Load cached data on startup
  useEffect(() => {
    loadCachedData();
    if (isOnline) loadCloudData();
  }, []);

  // Monitor online/offline
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncCachedData();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Get GPS location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => console.error('Location error:', error),
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
  }, []);

  // Initialize Google Map
  useEffect(() => {
    if (mapRef.current && currentLocation && window.google) {
      if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
  zoom: zoomLevel,
  center: { lat: currentLocation.lat, lng: currentLocation.lng },
  gestureHandling: 'greedy',
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
});
      } else {
        mapInstanceRef.current.setCenter({ lat: currentLocation.lat, lng: currentLocation.lng });
        mapInstanceRef.current.setZoom(zoomLevel);
      }

      // Clear old markers
      if (mapInstanceRef.current.markers) {
        mapInstanceRef.current.markers.forEach(marker => marker.setMap(null));
      }
      mapInstanceRef.current.markers = [];

      // Add current location marker (blue)
      const currentMarker = new window.google.maps.Marker({
        position: { lat: currentLocation.lat, lng: currentLocation.lng },
        map: mapInstanceRef.current,
        title: 'Your Location',
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
      });
      mapInstanceRef.current.markers.push(currentMarker);

      // Add parking marker (red)
      if (parkingLocation) {
        const parkingMarker = new window.google.maps.Marker({
          position: { lat: parkingLocation.lat, lng: parkingLocation.lng },
          map: mapInstanceRef.current,
          title: 'Your Car',
          icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
        });
        mapInstanceRef.current.markers.push(parkingMarker);

        if (parkingPhoto) {
          const infoWindow = new window.google.maps.InfoWindow({
            content: `<div style="width: 200px;"><strong>Your Car</strong><br><img src="${parkingPhoto}" style="width: 100%; margin-top: 10px; border-radius: 4px;"></div>`,
          });
          parkingMarker.addListener('click', () => infoWindow.open(mapInstanceRef.current, parkingMarker));
        }
      }

      // Add saved location markers (orange)
      savedLocations.forEach((loc) => {
        const locMarker = new window.google.maps.Marker({
          position: { lat: loc.latitude, lng: loc.longitude },
          map: mapInstanceRef.current,
          title: loc.label,
          icon: 'http://maps.google.com/mapfiles/ms/icons/orange-dot.png',
        });
        mapInstanceRef.current.markers.push(locMarker);

        if (loc.photoUrl) {
          const infoWindow = new window.google.maps.InfoWindow({
            content: `<div style="width: 200px;"><strong>${loc.label}</strong><br><img src="${loc.photoUrl}" style="width: 100%; margin-top: 10px; border-radius: 4px;"></div>`,
          });
          locMarker.addListener('click', () => infoWindow.open(mapInstanceRef.current, locMarker));
        }
      });
    }
  }, [currentLocation, parkingLocation, savedLocations, zoomLevel, parkingPhoto]);

  // Load Google Maps script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  const loadCachedData = () => {
    const cached = localStorage.getItem('parkNPinCache');
    if (cached) {
      const data = JSON.parse(cached);
      if (data.parkingLocation) setParkingLocation(data.parkingLocation);
      if (data.parkingPhoto) setParkingPhoto(data.parkingPhoto);
      if (data.savedLocations) setSavedLocations(data.savedLocations);
    }
  };

  const loadCloudData = async () => {
    if (!isOnline) return;
    try {
      const locationsRef = collection(db, 'users', userId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSavedLocations(locations);
      const parkingPin = locations.find(loc => loc.category === 'parking' && loc.isActive);
      if (parkingPin) {
        setParkingLocation({ lat: parkingPin.latitude, lng: parkingPin.longitude });
        setParkingPhoto(parkingPin.photoUrl || null);
      }
    } catch (error) {
      console.error('Error loading cloud data:', error);
    }
  };

  const saveToCache = (parkingLoc, savedLocs, photo) => {
    localStorage.setItem('parkNPinCache', JSON.stringify({
      parkingLocation: parkingLoc,
      parkingPhoto: photo,
      savedLocations: savedLocs,
      timestamp: new Date().toISOString(),
    }));
  };

  const syncCachedData = async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    try {
      if (parkingLocation) {
        const parkingRef = collection(db, 'users', userId, 'locations');
        const existing = (await getDocs(query(parkingRef))).docs.filter(d => d.data().category === 'parking');
        if (existing.length > 0) {
          await updateDoc(doc(db, 'users', userId, 'locations', existing[0].id), {
            latitude: parkingLocation.lat,
            longitude: parkingLocation.lng,
            photoUrl: parkingPhoto,
            syncedAt: new Date(),
          });
        } else {
          await addDoc(parkingRef, {
            latitude: parkingLocation.lat,
            longitude: parkingLocation.lng,
            label: 'My Car',
            category: 'parking',
            isActive: true,
            photoUrl: parkingPhoto,
            timestamp: new Date(),
          });
        }
      }
      for (const loc of savedLocations) {
        if (!loc.id || loc.id.includes('local')) {
          await addDoc(collection(db, 'users', userId, 'locations'), {
            latitude: loc.latitude,
            longitude: loc.longitude,
            label: loc.label,
            category: 'custom',
            photoUrl: loc.photoUrl,
            timestamp: new Date(),
          });
        }
      }
      setIsSyncing(false);
    } catch (error) {
      console.error('Sync error:', error);
      setIsSyncing(false);
    }
  };

  const handlePinCar = () => {
    if (!currentLocation) return;
    setIsAnimating(true);
    setParkingLocation(currentLocation);
    setShowPhotoPrompt(true);
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance('Done!');
    synth.speak(utterance);
    saveToCache(currentLocation, savedLocations, null);
    setTimeout(() => setIsAnimating(false), 2000);
  };

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const photoDataUrl = event.target.result;
        setParkingPhoto(photoDataUrl);
        saveToCache(parkingLocation, savedLocations, photoDataUrl);
        if (isOnline) {
          const photoRef = ref(storage, `users/${userId}/parking_photos/${Date.now()}`);
          uploadBytes(photoRef, file).then((snapshot) => {
            getDownloadURL(snapshot.ref).then((url) => {
              setParkingPhoto(url);
              saveToCache(parkingLocation, savedLocations, url);
            });
          });
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Photo upload error:', error);
    }
    setShowPhotoPrompt(false);
  };

  const handleAddLocation = () => {
    if (!currentLocation) return;
    const name = prompt('Name this location:');
    if (name) {
      const newLocation = {
        id: `local_${Date.now()}`,
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        label: name,
        category: 'custom',
        timestamp: new Date(),
      };
      const updated = [...savedLocations, newLocation];
      setSavedLocations(updated);
      saveToCache(parkingLocation, updated, parkingPhoto);
      if (isOnline) addDoc(collection(db, 'users', userId, 'locations'), newLocation);
    }
  };

  const handleDeleteLocation = async (id) => {
    const updated = savedLocations.filter(loc => loc.id !== id);
    setSavedLocations(updated);
    saveToCache(parkingLocation, updated, parkingPhoto);
    if (isOnline && !id.includes('local')) {
      await deleteDoc(doc(db, 'users', userId, 'locations', id));
    }
  };

  const handleClearParking = () => {
    setParkingLocation(null);
    setParkingPhoto(null);
    saveToCache(null, savedLocations, null);
  };

  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c).toFixed(1);
  };

  // MAP SCREEN
  if (screen === 'map') {
    return (
      <div className="h-screen w-full bg-white flex flex-col">
        <div className="bg-white border-b border-gray-200 p-4 shadow-sm">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center">
              <MapPin className="w-6 h-6 text-red-500 mr-2" />
              Park-N-Pin
            </h1>
            <div className="flex items-center gap-2">
              {isOnline ? <Wifi className="w-5 h-5 text-green-500" /> : <WifiOff className="w-5 h-5 text-red-500" />}
              <button onClick={() => setScreen('settings')} className="p-2 hover:bg-gray-100 rounded-lg">
                <Settings className="w-6 h-6 text-gray-600" />
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {isSyncing ? 'Syncing...' : isOnline ? 'Online & Ready' : 'Offline - Using cached data'}
          </p>
        </div>

        <div className="flex-1 relative overflow-hidden">
          <div ref={mapRef} className="w-full h-full" />

          {isAnimating && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 backdrop-blur-sm z-50">
              <div className="bg-white rounded-2xl p-8 shadow-2xl text-center">
                <div className="mb-4 text-6xl">✋</div>
                <div className="text-4xl mb-4 animate-pulse">📍</div>
                <p className="text-xl font-bold text-gray-800">Parking pinned!</p>
              </div>
            </div>
          )}

          <div className="absolute top-4 right-4 bg-white rounded-lg shadow-md p-2 flex flex-col gap-2">
            <button onClick={() => setZoomLevel(prev => Math.min(prev + 1, 20))} className="p-2 hover:bg-blue-100 rounded">
              <ZoomIn className="w-5 h-5 text-blue-600" />
            </button>
            <button onClick={() => setZoomLevel(prev => Math.max(prev - 1, 5))} className="p-2 hover:bg-blue-100 rounded">
              <ZoomOut className="w-5 h-5 text-blue-600" />
            </button>
          </div>

          {parkingLocation && (
            <div className="absolute bottom-4 left-4 bg-red-50 border-2 border-red-200 rounded-lg shadow-md p-4 max-w-xs z-40">
              <p className="text-sm font-bold text-red-700">🅿️ Your Car</p>
              {currentLocation && (
                <p className="text-sm font-semibold text-red-600 mt-2">
                  {calculateDistance(currentLocation.lat, currentLocation.lng, parkingLocation.lat, parkingLocation.lng)} miles away
                </p>
              )}
              
              {parkingPhoto && (
                <div className="mt-3">
                  <button 
                    onClick={() => setShowFullPhoto(true)}
                    className="w-full border-2 border-red-300 rounded-lg overflow-hidden hover:border-red-500 transition-colors"
                  >
                    <img 
                      src={parkingPhoto} 
                      alt="Parking spot" 
                      className="w-full h-24 object-cover"
                    />
                    <div className="bg-red-100 text-red-700 text-xs py-1 px-2 flex items-center justify-center gap-1">
                      <Camera className="w-3 h-3" />
                      Tap to view full size
                    </div>
                  </button>
                </div>
              )}
              
              <button onClick={handleClearParking} className="mt-3 w-full bg-red-500 hover:bg-red-600 text-white text-xs font-semibold py-2 rounded">
                Clear Parking Pin
              </button>
            </div>
          )}
        </div>

        {showPhotoPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm">
              <p className="text-lg font-bold text-gray-800 mb-4">Take a photo?</p>
              <div className="flex gap-2">
                <button onClick={() => setShowPhotoPrompt(false)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 rounded-lg">
                  Skip
                </button>
                <button onClick={() => cameraInputRef.current?.click()} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2">
                  <Camera className="w-4 h-4" />
                  Take Photo
                </button>
              </div>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} className="hidden" />
            </div>
          </div>
        )}

        {showFullPhoto && parkingPhoto && (
          <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50">
            <button 
              onClick={() => setShowFullPhoto(false)}
              className="absolute top-4 right-4 bg-white rounded-full p-2 hover:bg-gray-200 transition-colors"
            >
              <X className="w-6 h-6 text-gray-800" />
            </button>
            <img 
              src={parkingPhoto} 
              alt="Parking spot full size" 
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        )}

        <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="flex gap-2 mb-3">
            <button onClick={handlePinCar} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 text-lg">
              <MapPin className="w-6 h-6" />
              PARK MY CAR
            </button>
            <button onClick={handleAddLocation} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
              <MapPin className="w-5 h-5" />
              Save Location
            </button>
          </div>
        </div>

        <div className="bg-gray-50 border-t max-h-32 overflow-y-auto">
          {savedLocations.length > 0 && (
            <div className="p-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">📍 Saved Locations</p>
              {savedLocations.map((loc) => (
                <div key={loc.id} className="bg-white p-2 rounded flex justify-between items-center mb-2">
                  <div>
                    <p className="font-semibold text-sm">{loc.label}</p>
                    {currentLocation && <p className="text-xs text-gray-500">{calculateDistance(currentLocation.lat, currentLocation.lng, loc.latitude, loc.longitude)} mi</p>}
                  </div>
                  <button onClick={() => handleDeleteLocation(loc.id)} className="p-1 hover:bg-red-100 text-red-500 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // SETTINGS SCREEN
  if (screen === 'settings') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b p-4">
          <button onClick={() => setScreen('map')} className="text-blue-500 font-semibold mb-2">← Back</button>
          <h2 className="text-2xl font-bold">Settings</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-lg p-4 shadow">
            <h3 className="font-semibold mb-3">Status</h3>
            <p className="text-sm">{isOnline ? '🟢 Online' : '🔴 Offline'}</p>
            {isSyncing && <p className="text-blue-600 text-sm">⏳ Syncing...</p>}
          </div>
          <div className="bg-white rounded-lg p-4 shadow">
            <h3 className="font-semibold mb-3">About</h3>
            <p className="text-sm">Park-N-Pin v2.0</p>
            <p className="text-xs text-gray-500 mt-2">Never lose your car again.</p>
          </div>
        </div>
      </div>
    );
  }
}
