// Lightweight types shared between App.tsx and src/pages/ + src/components/.
// The strict AdConfig definition lives in App.tsx (it references many other
// UI-only types). Here `config: any` keeps the contract loose so pages and
// components don't have to know the full shape — structurally compatible
// with App.tsx's strict types via TypeScript's duck typing.

export type Step =
  | 'integrations'
  | 'projects'
  | 'persona'
  | 'copy'
  | 'hook-visual'
  | 'voz-premium'
  | 'avatar'
  | 'subtitles'
  | 'edit'
  | 'edit-zap'
  | 'edit2'
  | 'final'
  | 'scene-builder';

export type ProjectType = 'complete' | 'copy' | 'video' | 'editing';

export interface ProjectVariant {
  id: string;
  name: string;
  config: any;
  createdAt: any;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  type: ProjectType;
  config: any;
  variants?: ProjectVariant[];
  createdAt: any;
}
