import React, { useRef, useState, useMemo } from 'react';
import Globe from 'react-globe.gl';
import { FaUniversity, FaMapMarkerAlt, FaOrcid } from 'react-icons/fa';
import collaborators, { generationDate } from '../../assets/js/data/collaborations-cache.js';
import './styles/CollaboratorsGlobe.scss';

const PIN_COLOR = 'rgba(254, 62, 85, 0.7)';
const BORDER_COLOR = '#64ffda';

interface AffiliationData {
  name: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface Collaborator {
  id: string;
  name: string;
  orcid?: string;
  collaborations: number;
  latestPaperYear?: number;
  collaborationAffiliation: AffiliationData;
  currentAffiliation: AffiliationData;
  updatedManually: boolean;
}

interface LocationGroup {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  members: Collaborator[];
  totalPublications: number;
}

interface CollaboratorCardProps {
  location: LocationGroup;
  onClose: () => void;
}

const groupCollaboratorsByLocation = (data: Collaborator[]): LocationGroup[] => {
  const groups: Record<string, LocationGroup> = {};
  data.forEach((c) => {
    // Try collaboration affiliation first for coordinates, then current affiliation
    const loc = (c.collaborationAffiliation?.latitude && c.collaborationAffiliation?.longitude)
      ? c.collaborationAffiliation
      : (c.currentAffiliation?.latitude && c.currentAffiliation?.longitude ? c.currentAffiliation : null);

    if (loc?.latitude && loc?.longitude) {
      const key = `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
      if (!groups[key]) {
        groups[key] = {
          lat: loc.latitude,
          lng: loc.longitude,
          city: loc.city,
          country: loc.country,
          members: [],
          totalPublications: 0,
        };
      }
      groups[key].members.push(c);
      groups[key].totalPublications += c.collaborations || 0;
    }
  });
  return Object.values(groups);
};

const CollaboratorCard: React.FC<CollaboratorCardProps> = ({ location, onClose }) => {
  if (!location) return null;

  const members = location.members;
  const isMultiple = members.length > 1;

  const getDisplayAffiliation = (member: Collaborator) => {
    const coll = member.collaborationAffiliation;
    const curr = member.currentAffiliation;
    if (coll?.name && coll?.latitude && coll?.longitude) return coll;
    return curr || coll;
  };

  const headerAffiliation = getDisplayAffiliation(members[0])?.name || '';

  return (
    <div className="globe-card-wrapper">
      <button className="close-btn" onClick={onClose} aria-label="Close card">×</button>
      <div className="globe-card">
        <div className="globe-card-content">
          {isMultiple && (
            <div className="card-header">
              <h2 className="institute-count">
                {members.length} Collaborators from {headerAffiliation}
              </h2>
              <p className="location-header">
                <FaMapMarkerAlt />
                {location.city ? `${location.city}, ${location.country || ''}` : (location.country || '')}
              </p>
            </div>
          )}

          <div className="collaborators-list">
            {members.map((member, index) => {
              const displayAff = getDisplayAffiliation(member);
              const locationText = displayAff?.city 
                ? `${displayAff.city}, ${displayAff.country || ''}` 
                : (displayAff?.country || '');

              return (
                <div key={member.id || member.name + index} className="collaborator-item">
                  <div className="collaborator-item-header">
                    <h3>{member.name}</h3>
                    {member.orcid && (
                      <a href={member.orcid} target="_blank" rel="noopener noreferrer" className="orcid-link-icon" title="ORCID">
                        <FaOrcid size={20} />
                      </a>
                    )}
                  </div>

                  <div className="affiliation-info">
                    <div className="affiliation-section">
                      <p className="affiliation">
                        <FaUniversity />
                        {displayAff?.name || 'Unknown'}
                      </p>
                      {locationText && (
                        <p className="location">
                          <FaMapMarkerAlt />
                          {locationText}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="stats-vertical">
                    <div className="stat-item">
                      <span>Publications: {member.collaborations}</span>
                    </div>
                    <div className="stat-item">
                      <span>Latest Year of Publication: {member.latestPaperYear}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const CollaboratorsGlobe: React.FC = () => {
  const globeEl = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [clickedLocation, setClickedLocation] = useState<LocationGroup | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hasInitializedPOV, setHasInitializedPOV] = useState(false);
  const locations = useMemo(() => groupCollaboratorsByLocation(collaborators as Collaborator[]), []);

  const INITIAL_POV = { lat: 41.3926387, lng: 2.0577881, altitude: 2 };

  React.useEffect(() => {
    if (globeEl.current) {
      if (clickedLocation) {
        const isSmallScreen = window.innerWidth <= 1080;
        // On small screens, point the camera even further south of the pin
        // so that the pin itself appears higher towards the top-center
        const latOffset = isSmallScreen ? 35 : 0;
        
        globeEl.current.pointOfView({
          lat: Math.max(-90, clickedLocation.lat - latOffset),
          lng: clickedLocation.lng,
          altitude: 1.8 
        }, 1000);
      } else if (hasInitializedPOV) {
        globeEl.current.pointOfView(INITIAL_POV, 1000);
      }
    }
  }, [clickedLocation, hasInitializedPOV]);

  React.useEffect(() => {
    if (globeEl.current && dimensions.width > 0 && !hasInitializedPOV) {
      // Set initial position
      globeEl.current.pointOfView(INITIAL_POV);

      // Allow maximum zoom-in capacity
      const controls = globeEl.current.controls();
      if (controls) {
        controls.minDistance = 101; // Just above the globe surface (radius 100)
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
      }

      setHasInitializedPOV(true);
    }
  }, [dimensions.width, hasInitializedPOV]);

  React.useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    // Initial check with a small delay to ensure layout is ready
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    }, 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`globe-outer-container ${clickedLocation ? 'is-active' : ''}`}>
      <div className="globe-wrapper" ref={containerRef}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <Globe
            ref={globeEl}
            minAltitude={0.01}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png"
            showAtmosphere={true}
            atmosphereColor={BORDER_COLOR}
            atmosphereAltitude={0.15}

            htmlElementsData={locations}
            htmlLat={(d: any) => d.lat}
            htmlLng={(d: any) => d.lng}
            htmlAltitude={0.001}
            htmlElement={(d: any) => {
              const el = document.createElement('div');
              const isActive = clickedLocation && 
                               Math.abs(clickedLocation.lat - d.lat) < 0.01 && 
                               Math.abs(clickedLocation.lng - d.lng) < 0.01;
              
              const baseSize = 10;
              const scaleFactor = 5;
              let size = baseSize + Math.sqrt(d.totalPublications) * scaleFactor;
              
              if (isActive) {
                size *= 1.5; // Make active pin bigger
              }

              el.innerHTML = `
                <div class="map-pointer ${isActive ? 'is-active-pin' : ''}" style="
                  width: ${size}px;
                  height: ${size}px;
                  background: ${isActive ? '#64ffda' : PIN_COLOR};
                  border: 2px solid ${isActive ? '#fff' : 'rgba(254, 62, 85, 0.9)'};
                  border-radius: 50% 50% 50% 0;
                  transform: rotate(-45deg);
                  box-shadow: 0 0 ${isActive ? '25px #64ffda' : '10px ' + PIN_COLOR};
                  cursor: pointer;
                  position: relative;
                  transition: all 0.5s ease;
                ">
                  <div style="
                    width: ${size * 0.3}px;
                    height: ${size * 0.3}px;
                    background: rgba(255, 255, 255, 0.8);
                    border-radius: 50%;
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(45deg);
                  "></div>
                </div>
              `;

              el.style.pointerEvents = 'auto';
              el.style.cursor = 'pointer';
              el.onclick = () => setClickedLocation(d);

              return el;
            }}

            width={dimensions.width}
            height={dimensions.height}
          />
        )}
      </div>

      <div className={`card-wrapper ${clickedLocation ? 'show' : ''}`}>
        {clickedLocation && (
          <CollaboratorCard
            location={clickedLocation}
            onClose={() => setClickedLocation(null)}
          />
        )}
      </div>
    </div>
  );
};

export default CollaboratorsGlobe;
