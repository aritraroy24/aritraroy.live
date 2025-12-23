import React, { useRef, useState, useMemo } from 'react';
import Globe from 'react-globe.gl';
import { FaUniversity, FaMapMarkerAlt, FaOrcid } from 'react-icons/fa';
import collaborators from '../../assets/js/data/collaborations-cache.js';
import './styles/CollaboratorsGlobe.scss';

const PIN_COLOR = 'rgba(254, 62, 85, 0.7)';
const BORDER_COLOR = '#64ffda';

interface Collaborator {
  name: string;
  affiliation: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  collaborations: number;
  latestPaperYear?: number;
  orcid?: string;
  id?: string;
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
    if (c.latitude && c.longitude) {
      const key = `${c.latitude.toFixed(2)},${c.longitude.toFixed(2)}`;
      if (!groups[key]) {
        groups[key] = {
          lat: c.latitude,
          lng: c.longitude,
          city: c.city,
          country: c.country,
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
  const affiliation = members[0]?.affiliation || '';

  return (
    <div className="globe-card-wrapper">
      <button className="close-btn" onClick={onClose} aria-label="Close card">×</button>
      <div className="globe-card">
        <div className="globe-card-content">
          {isMultiple && (
            <div className="card-header">
              <h2 className="institute-count">
                {members.length} Collaborators from {affiliation}
              </h2>
              <p className="location-header">
                <FaMapMarkerAlt />
                {location.city ? `${location.city}, ` : ''}{location.country || ''}
              </p>
            </div>
          )}

          <div className="collaborators-list">
            {members.map((member, index) => (
              <div key={member.id || member.name + index} className="collaborator-item">
                <div className="collaborator-item-header">
                  <h3>{member.name}</h3>
                  {member.orcid && (
                    <a href={member.orcid} target="_blank" rel="noopener noreferrer" className="orcid-link-icon" title="ORCID">
                      <FaOrcid size={20} />
                    </a>
                  )}
                </div>

                {!isMultiple && (
                  <div className="affiliation-info">
                    <p className="affiliation">
                      <FaUniversity />
                      {member.affiliation}
                    </p>
                    <p className="location">
                      <FaMapMarkerAlt />
                      {member.city ? `${member.city}, ` : ''}{member.country || ''}
                    </p>
                  </div>
                )}

                <div className="stats-vertical">
                  <div className="stat-item">
                    <span>Publications: {member.collaborations}</span>
                  </div>
                  <div className="stat-item">
                    <span>Latest Year of Publication: {member.latestPaperYear}</span>
                  </div>
                </div>
              </div>
            ))}
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
  const locations = useMemo(() => groupCollaboratorsByLocation(collaborators as Collaborator[]), []);

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
    <div className="globe-outer-container">
      <div className="globe-wrapper" ref={containerRef}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <Globe
            ref={globeEl}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            showAtmosphere={true}
            atmosphereColor={BORDER_COLOR}
            atmosphereAltitude={0.2}

            labelsData={locations}
            labelLat={(d: any) => d.lat}
            labelLng={(d: any) => d.lng}
            labelText={() => ''}
            labelIncludeDot={true}
            labelDotRadius={(d: any) => {
              const baseSize = 1;
              const scaleFactor = 0.5;
              return baseSize + d.totalPublications * scaleFactor;
            }}
            labelColor={() => PIN_COLOR}
            labelDotOrientation={() => 'bottom'}
            onLabelClick={(label: any) => setClickedLocation(label)}

            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {clickedLocation && (
          <div className="card-wrapper">
            <CollaboratorCard
              location={clickedLocation}
              onClose={() => setClickedLocation(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaboratorsGlobe;
