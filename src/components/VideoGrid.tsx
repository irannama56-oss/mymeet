import React from 'react';
import { Participant } from '../lib/types';
import { VideoTile } from './VideoTile';

interface VideoGridProps {
  localParticipant: Participant;
  localStream: MediaStream | null;
  remoteParticipants: Participant[];
  remoteStreams: Map<string, MediaStream>;
  pinnedId: string | null;
  onTogglePin: (id: string) => void;
  screenStream: MediaStream | null;
  screenSharingParticipantId: string | null;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  localParticipant,
  localStream,
  remoteParticipants,
  remoteStreams,
  pinnedId,
  onTogglePin,
  screenStream,
  screenSharingParticipantId,
}) => {
  const allParticipants = [localParticipant, ...remoteParticipants];

  // Check if screen sharing is active
  const isScreenSharingActive = Boolean(screenStream || screenSharingParticipantId);
  const screenSharer = allParticipants.find(p => p.id === screenSharingParticipantId) || localParticipant;

  // Find pinned participant
  const pinnedParticipant = pinnedId
    ? allParticipants.find(p => p.id === pinnedId)
    : null;

  // Determine spotlight mode (either screen share or pinned user)
  const isSpotlightMode = isScreenSharingActive || Boolean(pinnedParticipant);

  if (isSpotlightMode) {
    const spotlightStream = screenStream 
      ? screenStream 
      : pinnedParticipant?.id === localParticipant.id 
        ? localStream 
        : pinnedParticipant ? remoteStreams.get(pinnedParticipant.id) : null;

    const spotlightParticipant = isScreenSharingActive ? screenSharer : pinnedParticipant!;
    const remainingParticipants = allParticipants.filter(p => p.id !== spotlightParticipant.id);

    return (
      <div className="w-full h-full flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        {/* Main Spotlight Area */}
        <div className="flex-1 h-[60vh] lg:h-full relative min-h-0">
          <VideoTile
            participant={spotlightParticipant}
            stream={spotlightStream}
            isLocal={spotlightParticipant.id === localParticipant.id && !isScreenSharingActive}
            isPinned={true}
            onTogglePin={onTogglePin}
            isScreenShareTile={isScreenSharingActive}
          />
        </div>

        {/* Thumbnail Sidebar Strip */}
        <div className="lg:w-72 xl:w-80 h-36 lg:h-full flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto shrink-0 pb-2 lg:pb-0">
          {/* If screen sharing, also show the sharer's camera */}
          {isScreenSharingActive && (
            <div className="w-52 sm:w-60 lg:w-full h-full lg:h-44 shrink-0">
              <VideoTile
                participant={spotlightParticipant}
                stream={spotlightParticipant.id === localParticipant.id ? localStream : remoteStreams.get(spotlightParticipant.id)}
                isLocal={spotlightParticipant.id === localParticipant.id}
                onTogglePin={onTogglePin}
              />
            </div>
          )}

          {remainingParticipants.map((p) => {
            const stream = p.id === localParticipant.id ? localStream : remoteStreams.get(p.id);
            return (
              <div key={p.id} className="w-52 sm:w-60 lg:w-full h-full lg:h-44 shrink-0">
                <VideoTile
                  participant={p}
                  stream={stream}
                  isLocal={p.id === localParticipant.id}
                  isPinned={false}
                  onTogglePin={onTogglePin}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Normal Equal Grid Layout based on total participant count
  const count = allParticipants.length;

  const getGridClasses = () => {
    switch (count) {
      case 1:
        return 'grid-cols-1 max-w-4xl mx-auto h-full max-h-[85vh]';
      case 2:
        return 'grid-cols-1 md:grid-cols-2 max-w-5xl mx-auto h-full max-h-[85vh]';
      case 3:
      case 4:
        return 'grid-cols-1 sm:grid-cols-2 grid-rows-2 max-w-6xl mx-auto h-full max-h-[88vh]';
      case 5:
      case 6:
        return 'grid-cols-2 md:grid-cols-3 max-w-7xl mx-auto h-full max-h-[88vh]';
      default:
        return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 max-w-7xl mx-auto h-full';
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className={`grid gap-4 w-full h-full items-center justify-center ${getGridClasses()}`}>
        {allParticipants.map((p) => {
          const stream = p.id === localParticipant.id ? localStream : remoteStreams.get(p.id);
          return (
            <div key={p.id} className="w-full h-full min-h-[220px]">
              <VideoTile
                participant={p}
                stream={stream}
                isLocal={p.id === localParticipant.id}
                isPinned={pinnedId === p.id}
                onTogglePin={onTogglePin}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
