/// <reference types="vite/client" />
import type { SavedAtlasAPI } from '../../shared/contracts'

declare global { interface Window { savedAtlas?: SavedAtlasAPI } }
export {}
