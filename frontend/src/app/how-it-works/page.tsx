import { Metadata } from 'next';
import { ArrowLeft, GitMerge, FileLock2, Aperture, Layers, Zap, Download } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How It Works | Folio',
  description: 'Learn about the Folio HDR background pipeline from first principles.',
};

export default function HowItWorksPage() {
  return (
    <main className="flex-1 flex flex-col w-full">
      <header className="w-full flex justify-between items-center px-4 py-4 md:py-6 md:px-8 z-40 relative border-b border-border sticky top-0 bg-background/80 backdrop-blur">
        <div className="flex gap-4 items-center">
          <Link href="/" aria-label="Back to Home" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex gap-3 items-baseline">
            <h1 className="text-lg md:text-xl font-bold tracking-tight m-0 leading-none">Folio</h1>
            <span className="font-mono text-[9px] md:text-[10px] uppercase tracking-widest px-1.5 py-0.5 bg-foreground text-background rounded-sm">Docs</span>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-12 md:py-20 flex flex-col gap-16">
        
        {/* Intro */}
        <section className="flex flex-col gap-6">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">How Folio Works: The Background Pipeline</h2>
          
          <div className="bg-surface border border-border rounded-xl p-6 md:p-8 flex flex-col gap-4">
            <h3 className="text-xl font-medium flex items-center gap-2"><Aperture className="w-5 h-5" /> The Bird&apos;s Eye: Philosophy & Architecture</h3>
            <p className="text-muted leading-relaxed">
              <strong>The Core Problem:</strong> Real estate interiors have extreme dynamic ranges—bright exterior windows and dark interior shadows. Cameras cannot capture this in a single shot.
            </p>
            <p className="text-muted leading-relaxed">
              <strong>The Folio Solution:</strong> By ingesting bracketed photography (multiple exposures like -2, 0, +2 EV), Folio mathematically merges them into a single, perfectly balanced High Dynamic Range (HDR) image, prioritizing architectural accuracy and natural lighting.
            </p>
          </div>
        </section>

        {/* Stage 1 */}
        <section className="flex flex-col gap-6">
          <h3 className="text-2xl font-semibold flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-bold" aria-hidden="true">1</span>
            Intelligent Ingestion (Local Processing)
          </h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <li className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-2">
              <strong className="text-foreground">Zero-Friction Import</strong>
              <span className="text-sm text-muted">Full-viewport dropzone accepting JPEGs, TIFFs, and HEICs with immediate local file validation.</span>
            </li>
            <li className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-2">
              <strong className="text-foreground">On-Device EXIF Parsing</strong>
              <span className="text-sm text-muted">Before any data leaves the device, the browser securely extracts capture time, exposure compensation (EV), aperture (f-stop), and ISO.</span>
            </li>
            <li className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-2">
              <strong className="text-foreground">Time-Based Scene Grouping</strong>
              <span className="text-sm text-muted">The algorithm groups continuous rapid-fire shots into scenes based on microsecond time gaps and exposure metadata.</span>
            </li>
            <li className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-2">
              <strong className="text-foreground">Visual AI Fallback</strong>
              <span className="text-sm text-muted">If images lack EXIF data, the client generates lightweight thumbnails to visually cluster photos by room angle without blocking uploads.</span>
            </li>
          </ul>
        </section>

        {/* Stage 2 */}
        <section className="flex flex-col gap-6">
          <h3 className="text-2xl font-semibold flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-bold" aria-hidden="true">2</span>
            Direct-to-Cloud Secure Transfer
          </h3>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 bg-surface border border-border p-6 rounded-lg flex flex-col gap-3">
              <Zap className="w-6 h-6 text-foreground" />
              <strong className="text-lg">Accelerated Transfer</strong>
              <p className="text-sm text-muted leading-relaxed">To ensure maximum speed, the frontend requests secure signed URLs and uploads original brackets directly to the cloud storage layer.</p>
            </div>
            <div className="flex-1 bg-surface border border-border p-6 rounded-lg flex flex-col gap-3">
              <FileLock2 className="w-6 h-6 text-foreground" />
              <strong className="text-lg">Ephemeral Privacy & Agency Settings</strong>
              <p className="text-sm text-muted leading-relaxed">All data is tied to secure, 48-hour ephemeral sessions identified by unguessable Room Codes. Agency style profiles and quotas are securely isolated via Firebase Auth.</p>
            </div>
          </div>
        </section>

        {/* Stage 3 */}
        <section className="flex flex-col gap-6">
          <h3 className="text-2xl font-semibold flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-bold" aria-hidden="true">3</span>
            The Hybrid Engine (OpenCV + AI Polish)
          </h3>
          
          <div className="flex flex-col gap-4">
            <div className="border-l-2 border-border pl-4 py-1">
              <strong className="block text-foreground mb-1">Bracket Caching (Short-Circuit)</strong>
              <span className="text-sm text-muted">Before processing begins, Folio hashes the incoming brackets. If identical photos have been processed previously, the system serves the HDR result instantly from cache.</span>
            </div>
            <div className="border-l-2 border-border pl-4 py-1">
              <strong className="block text-foreground mb-1">Pre-Merge Optimization</strong>
              <span className="text-sm text-muted">Original brackets are downsampled to an optimized 2K resolution (2048px), the perfect size for MLS, ensuring blazing fast processing without freezing server resources.</span>
            </div>
            <div className="border-l-2 border-border pl-4 py-1">
              <strong className="block text-foreground mb-1">Halo-Free Contrast (OpenCV Base)</strong>
              <span className="text-sm text-muted">Corrects micro-jitter, applies custom exposure fusion prioritizing dark brackets for exterior views, and utilizes CLAHE in LAB color space to boost brightness without glowing halos.</span>
            </div>
            <div className="border-l-2 border-border pl-4 py-1">
              <strong className="block text-foreground mb-1">Bracket Pruning & Optimized Uploads</strong>
              <span className="text-sm text-muted">To optimize the VLM process, Folio sends only two inputs to the model: the perfectly fused OpenCV base and the single darkest bracket. Uploads are hoisted to accelerate processing.</span>
            </div>
            <div className="border-l-2 border-border pl-4 py-1">
              <strong className="block text-foreground mb-1">Deterministic Generative Polish</strong>
              <span className="text-sm text-muted">The pruned inputs are refined by a VLM running at a strict temperature of <code>0.0</code>. This guarantees structural adherence while applying agency-specific color grading.</span>
            </div>
          </div>
        </section>

        {/* Stage 4 */}
        <section className="flex flex-col gap-6">
          <h3 className="text-2xl font-semibold flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-sm font-bold" aria-hidden="true">4</span>
            Zero-Wait Local Delivery
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-3">
              <Layers className="w-5 h-5 text-muted" />
              <strong className="text-sm">Real-Time Feedback</strong>
              <span className="text-xs text-muted">Optimized batch-status syncing drives a deterministic UI without hammering the network.</span>
            </div>
            <div className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-3">
              <GitMerge className="w-5 h-5 text-muted" />
              <strong className="text-sm">Review & Verification</strong>
              <span className="text-xs text-muted">Flagged images (where AI QA executed a safe fallback) are clearly marked for verification.</span>
            </div>
            <div className="bg-surface border border-border p-5 rounded-lg flex flex-col gap-3">
              <Download className="w-5 h-5 text-muted" />
              <strong className="text-sm">Instant Device Packaging</strong>
              <span className="text-xs text-muted">Approved images are packaged directly on the user&apos;s device (using Web Share API or batched ZIPs), eliminating server wait times.</span>
            </div>
          </div>
        </section>
        
        <footer className="mt-8 pt-8 border-t border-border text-center text-sm text-muted">
          Folio relies on extreme deterministic reliability, backed by comprehensive testing across the client and backend pipeline.
        </footer>
      </div>
    </main>
  );
}
