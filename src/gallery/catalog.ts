export type MediaKind = 'photo' | 'video';

export type PhotoGroup = 'raw' | 'cleaned' | 'fumed' | 'resin' | 'surfacer';
export type VideoGroup = 'fail04' | 'cylinder' | 'fail02' | 'figure' | 'resin';
export type GalleryGroup = PhotoGroup | VideoGroup;

export type GalleryItem = {
  id: string;
  kind: MediaKind;
  group: GalleryGroup;
  src: string;
  poster?: string;
  caption: string;
  note?: string;
};

export const PHOTO_FILTERS: { id: PhotoGroup; label: string }[] = [
  { id: 'raw', label: '무가공' },
  { id: 'cleaned', label: '가공' },
  { id: 'fumed', label: '훈증' },
  { id: 'resin', label: '레진' },
  { id: 'surfacer', label: '서페' },
];

export const VIDEO_FILTERS: { id: VideoGroup; label: string }[] = [
  { id: 'fail04', label: '0.4 실패' },
  { id: 'cylinder', label: '원통 테스트' },
  { id: 'fail02', label: '0.2 실패' },
  { id: 'figure', label: '피규어' },
  { id: 'resin', label: '레진' },
];

const photo = (file: string, group: PhotoGroup, caption: string, note?: string): GalleryItem => ({
  id: `photo-${file}`,
  kind: 'photo',
  group,
  src: `/gallery/photos/${encodeURIComponent(file)}`,
  caption,
  note,
});

const timelapse = (
  stem: string,
  group: VideoGroup,
  caption: string,
  note?: string,
): GalleryItem => ({
  id: `tl-${stem}`,
  kind: 'video',
  group,
  src: `/gallery/timelapse/${encodeURIComponent(`${stem}.mp4`)}`,
  poster: `/gallery/posters/${encodeURIComponent(`${stem}.jpg`)}`,
  caption,
  note,
});

const clip = (file: string, posterFile: string, caption: string): GalleryItem => ({
  id: `clip-${file}`,
  kind: 'video',
  group: 'resin',
  src: `/gallery/clips/${encodeURIComponent(file)}`,
  poster: `/gallery/photos/${encodeURIComponent(posterFile)}`,
  caption,
});

export const GALLERY_ITEMS: GalleryItem[] = [
  photo('무가공1.jpg', 'raw', '무가공 1'),
  photo('무가공2.jpg', 'raw', '무가공 2'),
  photo('무가공3.jpg', 'raw', '무가공 3'),
  photo('무가공4.jpg', 'raw', '무가공 4'),
  photo('가공1.jpg', 'cleaned', '가공 1'),
  photo('가공2.jpg', 'cleaned', '가공 2'),
  photo('가공3.jpg', 'cleaned', '가공 3'),
  photo('훈증1.jpg', 'fumed', '훈증 1'),
  photo('훈증2.jpg', 'fumed', '훈증 2'),
  photo('훈증3.jpg', 'fumed', '훈증 3'),
  photo('훈증4.jpg', 'fumed', '훈증 4'),
  photo('훈증5.jpg', 'fumed', '훈증 5'),
  photo('훈증6.jpg', 'fumed', '훈증 6'),
  photo('레진1.jpg', 'resin', '레진 1 · UV 경화 세팅'),
  photo('레진2.jpg', 'resin', '레진 2'),
  photo('레진3.jpg', 'resin', '레진 3'),
  photo('레진4.jpg', 'resin', '레진 4'),
  clip('레진1.mp4', '레진1.jpg', '레진 영상 1'),
  clip('레진2.mp4', '레진2.jpg', '레진 영상 2'),
  photo('레진이후서페.jpg', 'surfacer', '레진 이후 서페 1'),
  photo('레진이후서페2.jpg', 'surfacer', '레진 이후 서페 2'),
  photo('레진이후서페3.jpg', 'surfacer', '레진 이후 서페 3'),
  photo('후가공이후서페1.jpg', 'surfacer', '후가공 이후 서페 1'),
  photo('후가공이후서페2.jpg', 'surfacer', '후가공 이후 서페 2'),
  photo('후가공이후서페3.jpg', 'surfacer', '후가공 이후 서페 3'),
  photo('서페이후그라인더1.jpg', 'surfacer', '서페 이후 그라인더 1', '서페이서 이후 그라인더로 후가공'),
  photo('서페이후그라인더2.jpg', 'surfacer', '서페 이후 그라인더 2', '서페이서 이후 그라인더로 후가공'),
  photo('서페이후그라인더3.jpg', 'surfacer', '서페 이후 그라인더 3', '서페이서 이후 그라인더로 후가공'),
  photo('서페이후그라인더4.jpg', 'surfacer', '서페 이후 그라인더 4', '서페이서 이후 그라인더로 후가공'),
  photo('서페이후그라인더5.jpg', 'surfacer', '서페 이후 그라인더 5', '서페이서 이후 그라인더로 후가공'),
  timelapse('04노즐_실패1_기본값_기본베드', 'fail04', '실패 1 · 기본값 · 기본 베드', '타임랩스가 거의 안 남음'),
  timelapse('04노즐_실패2_기본값_기본베드', 'fail04', '실패 2 · 기본값 · 기본 베드', '타임랩스가 거의 안 남음'),
  timelapse('02노즐_원통테스트1', 'cylinder', '원통 테스트 1'),
  timelapse('02노즐_원통테스트2', 'cylinder', '원통 테스트 2'),
  timelapse('02노즐_원통테스트3', 'cylinder', '원통 테스트 3'),
  timelapse('02노즐_실패3_거미줄', 'fail02', '실패 3 · 거미줄'),
  timelapse('02노즐_실패4_서포터뜯김', 'fail02', '실패 4 · 서포터 뜯김'),
  timelapse('02노즐_실패5_서포터부서짐', 'fail02', '실패 5 · 서포터 부서짐'),
  timelapse('02노즐_실패6', 'fail02', '실패 6'),
  timelapse('02노즐_실패7_레이어안착불량', 'fail02', '실패 7 · 레이어 안착 불량'),
  timelapse('02노즐_실패8_인필중일그러짐', 'fail02', '실패 8 · 인필 중 일그러짐'),
  timelapse('02노즐_실패9_서포터부서짐', 'fail02', '실패 9 · 서포터 부서짐'),
  timelapse('02노즐_피규어작게테스트', 'figure', '피규어 작게 테스트'),
  timelapse('02노즐_피규어1', 'figure', '피규어 1'),
  timelapse('02노즐_피규어2', 'figure', '피규어 2'),
];

export type FilterId = 'all' | GalleryGroup;

export function itemsForFilter(filter: FilterId): GalleryItem[] {
  if (filter === 'all') return GALLERY_ITEMS;
  return GALLERY_ITEMS.filter((item) => item.group === filter);
}
