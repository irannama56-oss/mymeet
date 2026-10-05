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

  // Identify who is screen sharing (local or remote)
  const screenSharer =
    allParticipants.find(
      (p) => p.id === screenSharingParticipantId || p.isScreenSharing
    ) || (screenStream ? localParticipant : null);

  const isScreenSharingActive = Boolean(screenSharer);

  // Identify pinned participant (if any)
  const pinnedParticipant = pinnedId
    ? allParticipants.find((p) => p.id === pinnedId)
    : null;

  // Spotlight mode is active if someone is screen sharing OR someone is pinned
  const isSpotlightMode = isScreenSharingActive || Boolean(pinnedParticipant);

  if (isSpotlightMode) {
    const isSharerLocal = screenSharer?.id === localParticipant.id;

    // Determine the spotlighted stream
    let spotlightStream: MediaStream | null = null;
    let spotlightParticipant: Participant;

    if (isScreenSharingActive && screenSharer) {
      spotlightParticipant = screenSharer;
      spotlightStream = isSharerLocal
        ? screenStream || localStream
        : remoteStreams.get(screenSharer.id) || null;
    } else {
      spotlightParticipant = pinnedParticipant!;
      spotlightStream =
        spotlightParticipant.id === localParticipant.id
          ? localStream
          : remoteStreams.get(spotlightParticipant.id) || null;
    }

    // Remaining participants for the side/bottom thumbnail strip
    const remainingParticipants = allParticipants.filter(
      (p) => p.id !== spotlightParticipant.id
    );

    // The spotlight tile can be the local user (screen sharing, or pinned). Passing the
    // real "is this me" flag is what stops the tile from rendering an unmuted <audio>
    // element pointed at our own microphone / screen audio — i.e. hearing yourself.
    const isSpotlightLocal = spotlightParticipant.id === localParticipant.id;

    return (
      <div className="w-full h-full flex flex-col lg:flex-row gap-4 p-2 sm:p-4 overflow-hidden">
        {/* Main Spotlight Area (Large Viewport) */}
        <div className="flex-1 h-[55vh] sm:h-[60vh] lg:h-full relative min-h-0 min-w-0">
          <VideoTile
            participant={spotlightParticipant}
            stream={spotlightStream}
            isLocal={isSpotlightLocal}
            isPinned={true}
            onTogglePin={onTogglePin}
            isScreenShareTile={isScreenSharingActive}
          />
        </div>

        {/* Thumbnail Strip (Participants Sidebar / Bottom Carousel on Mobile) */}
        <div className="lg:w-72 xl:w-80 h-36 lg:h-full flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto shrink-0 pb-2 lg:pb-0">
          {/* If screen sharing, show the presenter's camera tile in the strip */}
          {isScreenSharingActive && (
            <div className="w-48 sm:w-56 lg:w-full h-full lg:h-44 shrink-0">
              <VideoTile
                participant={spotlightParticipant}
                stream={
                  isSharerLocal
                    ? localStream
                    : remoteStreams.get(spotlightParticipant.id)
                }
                isLocal={isSharerLocal}
                onTogglePin={onTogglePin}
                isScreenShareTile={false}
              />
            </div>
          )}

          {/* Other participants */}
          {remainingParticipants.map((p) => {
            const stream =
              p.id === localParticipant.id ? localStream : remoteStreams.get(p.id);
            return (
              <div
                key={p.id}
                className="w-48 sm:w-56 lg:w-full h-full lg:h-44 shrink-0"
              >
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

  // Normal Equal Grid Layout based on participant count
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
    <div className="w-full h-full flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div
        className={`grid gap-3 sm:gap-4 w-full h-full items-stretch justify-center auto-rows-fr ${getGridClasses()}`}
      >
        {allParticipants.map((p) => {
          const stream =
            p.id === localParticipant.id ? localStream : remoteStreams.get(p.id);
          return (
            <div key={p.id} className="w-full h-full min-h-0 min-w-0">
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
