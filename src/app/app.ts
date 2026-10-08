
import {
  Component,
  ElementRef,
  ViewChild,
  ChangeDetectorRef,
  NgZone,
  OnDestroy
} from '@angular/core';

import { PDFDocument } from 'pdf-lib';

interface SelectedImage {
  id: number;
  file: File;
  previewUrl: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  @ViewChild('cameraVideo')
  cameraVideo?: ElementRef<HTMLVideoElement>;

  selectedFiles: SelectedImage[] = [];

  isDragging = false;
  isConverting = false;
  cameraOpen = false;

  convertedPdfUrl: string | null = null;
  convertedFileName = '';
  convertedPageCount = 0;

  message = '';
  messageType: 'success' | 'error' | '' = '';

  private nextId = 1;
  private cameraStream: MediaStream | null = null;
  private readonly maxFileSize = 50 * 1024 * 1024;

  constructor(
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  // FILE UPLOAD

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.files) {
      this.addFiles(Array.from(input.files));
    }

    input.value = '';
  }

  private addFiles(files: File[]): void {
    if (this.isConverting) return;

    let accepted = 0;
    let rejected = 0;

    for (const file of files) {
      const supported =
        file.type === 'image/png' ||
        file.type === 'image/jpeg';

      if (
        !supported ||
        file.size === 0 ||
        file.size > this.maxFileSize
      ) {
        rejected++;
        continue;
      }

      this.selectedFiles.push({
        id: this.nextId++,
        file,
        previewUrl: URL.createObjectURL(file)
      });

      accepted++;
    }

    if (accepted > 0) {
      this.resetConvertedResult();
    }

    if (rejected > 0) {
      this.showMessage(
        `${rejected} file(s) skipped. Use PNG/JPEG files up to 50 MB.`,
        'error'
      );
    } else if (accepted > 0) {
      this.message = '';
      this.messageType = '';
    }

    this.cdr.detectChanges();
  }

  // DRAG AND DROP

  onDragOver(event: DragEvent): void {
    event.preventDefault();

    if (!this.isConverting) {
      this.isDragging = true;
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;

    if (event.dataTransfer?.files) {
      this.addFiles(Array.from(event.dataTransfer.files));
    }
  }

  // FILE MANAGEMENT

  removeFile(index: number): void {
    if (this.isConverting) return;

    const item = this.selectedFiles[index];
    if (!item) return;

    URL.revokeObjectURL(item.previewUrl);
    this.selectedFiles.splice(index, 1);
    this.resetConvertedResult();
  }

  clearFiles(): void {
    if (this.isConverting) return;

    for (const item of this.selectedFiles) {
      URL.revokeObjectURL(item.previewUrl);
    }

    this.selectedFiles = [];
    this.resetConvertedResult();
    this.message = '';
    this.messageType = '';
  }

  moveFile(index: number, direction: number): void {
    if (this.isConverting) return;

    const target = index + direction;

    if (target < 0 || target >= this.selectedFiles.length) {
      return;
    }

    const [item] = this.selectedFiles.splice(index, 1);
    this.selectedFiles.splice(target, 0, item);

    this.resetConvertedResult();
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // CAMERA

  async openCamera(): Promise<void> {
    if (this.cameraOpen || this.isConverting) return;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' }
        }
      });

      this.cameraStream = stream;

      this.zone.run(() => {
        this.cameraOpen = true;
        this.cdr.detectChanges();
      });

      const video = this.cameraVideo?.nativeElement;

      if (!video) {
        throw new Error('Camera preview not found');
      }

      video.srcObject = stream;
      await video.play();

    } catch (error) {
      console.error('Camera error:', error);
      this.closeCamera();

      this.showMessage(
        'Camera unavailable. Check permissions and use localhost or HTTPS.',
        'error'
      );

      this.cdr.detectChanges();
    }
  }

  async capturePhoto(): Promise<void> {
    const video = this.cameraVideo?.nativeElement;

    if (!video || !video.videoWidth || !video.videoHeight) {
      this.showMessage('Camera is not ready.', 'error');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');

    if (!context) {
      this.showMessage('Could not capture photo.', 'error');
      return;
    }

    context.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });

    if (!blob) {
      this.showMessage('Photo capture failed.', 'error');
      return;
    }

    this.zone.run(() => {
      const file = new File(
        [blob],
        `photo-${Date.now()}.jpg`,
        { type: 'image/jpeg' }
      );

      this.addFiles([file]);
      this.closeCamera();
      this.cdr.detectChanges();
    });
  }

  closeCamera(): void {
    const video = this.cameraVideo?.nativeElement;

    if (video) {
      video.srcObject = null;
    }

    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }

    this.cameraOpen = false;
  }

  // PDF CONVERSION

  async convertToPdf(): Promise<void> {
    if (this.isConverting || this.selectedFiles.length === 0) {
      return;
    }

    this.isConverting = true;
    this.message = '';
    this.messageType = '';

    this.cdr.detectChanges();

    const startTime = Date.now();
    const minimumAnimationTime = 2600;

    // Allow the rocket animation to start.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 100);
    });

    try {
      console.log('Rocket PDF: Starting conversion');

      const pdf = await PDFDocument.create();

      for (let i = 0; i < this.selectedFiles.length; i++) {
        const item = this.selectedFiles[i];

        console.log(
          `Processing image ${i + 1}: ${item.file.name}`
        );

        const bytes = await item.file.arrayBuffer();

        const image = item.file.type === 'image/png'
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);

        const page = pdf.addPage([
          image.width,
          image.height
        ]);

        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height
        });
      }

      console.log('Saving PDF...');

      const pdfBytes = await pdf.save();

      console.log('PDF generated:', pdfBytes.length, 'bytes');

      const output = new Uint8Array(pdfBytes.length);
      output.set(pdfBytes);

      const blob = new Blob([output.buffer], {
        type: 'application/pdf'
      });

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(
        0,
        minimumAnimationTime - elapsed
      );

      if (remaining > 0) {
        await new Promise<void>(resolve => {
          setTimeout(resolve, remaining);
        });
      }

      this.zone.run(() => {
        this.resetConvertedResult();

        this.convertedPdfUrl = URL.createObjectURL(blob);

        this.convertedFileName =
          this.selectedFiles.length === 1
            ? this.selectedFiles[0].file.name.replace(/\.[^.]+$/, '') + '.pdf'
            : 'rocket-pdf-document.pdf';

        this.convertedPageCount = this.selectedFiles.length;

        this.isConverting = false;

        this.showMessage(
          'Mission accomplished! Your PDF is ready.',
          'success'
        );

        this.cdr.detectChanges();
      });

      console.log('Rocket PDF: Conversion completed');

    } catch (error) {
      console.error('Rocket PDF conversion failed:', error);

      this.zone.run(() => {
        this.isConverting = false;

        this.showMessage(
          'Conversion failed. Check the browser console for details.',
          'error'
        );

        this.cdr.detectChanges();
      });
    } finally {
      this.zone.run(() => {
        this.isConverting = false;
        this.cdr.detectChanges();
      });
    }
  }

  // PDF ACTIONS

  openPdf(): void {
    if (!this.convertedPdfUrl) return;

    const newTab = window.open(
      this.convertedPdfUrl,
      '_blank'
    );

    if (!newTab) {
      this.showMessage(
        'Could not open PDF. Allow pop-ups or use Download PDF.',
        'error'
      );
    }
  }

  downloadPdf(): void {
    if (!this.convertedPdfUrl) return;

    const link = document.createElement('a');
    link.href = this.convertedPdfUrl;
    link.download = this.convertedFileName;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // HELPERS

  private resetConvertedResult(): void {
    if (this.convertedPdfUrl) {
      URL.revokeObjectURL(this.convertedPdfUrl);
    }

    this.convertedPdfUrl = null;
    this.convertedFileName = '';
    this.convertedPageCount = 0;
  }

  private showMessage(
    text: string,
    type: 'success' | 'error'
  ): void {
    this.message = text;
    this.messageType = type;
  }

  ngOnDestroy(): void {
    this.closeCamera();

    for (const item of this.selectedFiles) {
      URL.revokeObjectURL(item.previewUrl);
    }

    this.resetConvertedResult();
  }
}
