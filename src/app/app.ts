
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
  format: 'png' | 'jpeg';
  width: number;
  height: number;
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
  conversionProgress = 0;

  convertedPdfUrl: string | null = null;
  convertedFileName = '';
  convertedPageCount = 0;

  message = '';
  messageType: 'success' | 'error' | '' = '';

  private nextId = 1;
  private cameraStream: MediaStream | null = null;
  private readonly maxFileSize = 50 * 1024 * 1024;
  private readonly maxTotalFileSize = 50 * 1024 * 1024;

  constructor(
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  // FILE UPLOAD

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.files) {
      void this.addFiles(Array.from(input.files));
    }

    input.value = '';
  }

  private async addFiles(files: File[]): Promise<void> {
    if (this.isConverting) return;

    let accepted = 0;
    let unsupported = 0;
    let oversized = 0;
    let totalLimit = 0;
    let unreadable = 0;
    let selectedTotalSize = this.selectedFiles.reduce(
      (sum, item) => sum + item.file.size,
      0
    );

    for (const file of files) {
      const format = this.getImageFormat(file);

      if (!format) {
        unsupported++;
        continue;
      }

      if (file.size === 0 || file.size > this.maxFileSize) {
        oversized++;
        continue;
      }

      if (selectedTotalSize + file.size > this.maxTotalFileSize) {
        totalLimit++;
        continue;
      }

      const previewUrl = URL.createObjectURL(file);

      try {
        const dimensions = await this.readImageDimensions(previewUrl);

        selectedTotalSize += file.size;

        this.selectedFiles.push({
          id: this.nextId++,
          file,
          previewUrl,
          format,
          width: dimensions.width,
          height: dimensions.height
        });

        accepted++;
      } catch (error) {
        console.error('Image preview failed:', error);
        URL.revokeObjectURL(previewUrl);
        unreadable++;
      }
    }

    if (accepted > 0) {
      this.resetConvertedResult();
    }

    const validationMessages: string[] = [];

    if (unsupported > 0) {
      validationMessages.push(
        `${unsupported} unsupported file(s) skipped. Use PNG or JPEG images.`
      );
    }

    if (oversized > 0) {
      validationMessages.push(
        `${oversized} oversized file(s) skipped. Each image must be 50 MB or less.`
      );
    }

    if (totalLimit > 0) {
      validationMessages.push(
        `${totalLimit} file(s) skipped. Total selected images must stay under 50 MB.`
      );
    }

    if (unreadable > 0) {
      validationMessages.push(
        `${unreadable} image file(s) could not be read.`
      );
    }

    if (validationMessages.length > 0) {
      this.showMessage(validationMessages.join(' '), 'error');
    } else if (accepted > 0) {
      this.message = '';
      this.messageType = '';
    }

    this.cdr.detectChanges();
  }

  private getImageFormat(file: File): 'png' | 'jpeg' | null {
    const name = file.name.toLowerCase();

    if (file.type === 'image/png' || name.endsWith('.png')) {
      return 'png';
    }

    if (
      file.type === 'image/jpeg' ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg')
    ) {
      return 'jpeg';
    }

    return null;
  }

  private readImageDimensions(
    previewUrl: string
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight
        });
      };

      image.onerror = () => {
        reject(new Error('Image could not be loaded'));
      };

      image.src = previewUrl;
    });
  }

  getSelectedTotalSize(): string {
    const total = this.selectedFiles.reduce(
      (sum, item) => sum + item.file.size,
      0
    );

    return this.formatFileSize(total);
  }

  getSelectedTotalPercent(): number {
    const total = this.selectedFiles.reduce(
      (sum, item) => sum + item.file.size,
      0
    );

    return Math.min(
      100,
      Math.round((total / this.maxTotalFileSize) * 100)
    );
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
      void this.addFiles(Array.from(event.dataTransfer.files));
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

    const file = new File(
      [blob],
      `photo-${Date.now()}.jpg`,
      { type: 'image/jpeg' }
    );

    await this.addFiles([file]);
    this.closeCamera();
    this.cdr.detectChanges();
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
    this.conversionProgress = 0;
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

        const image = item.format === 'png'
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

        this.conversionProgress = Math.round(
          ((i + 1) / this.selectedFiles.length) * 85
        );
        this.cdr.detectChanges();
      }

      console.log('Saving PDF...');

      const pdfBytes = await pdf.save();

      if (pdfBytes.length > this.maxTotalFileSize) {
        throw new Error('Generated PDF exceeds 50 MB');
      }

      console.log('PDF generated:', pdfBytes.length, 'bytes');
      this.conversionProgress = 95;
      this.cdr.detectChanges();

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
        this.conversionProgress = 100;

        this.showMessage(
          'Mission accomplished! Your PDF is ready and the download has started.',
          'success'
        );

        this.cdr.detectChanges();
        this.triggerPdfDownload();
      });

      console.log('Rocket PDF: Conversion completed');

    } catch (error) {
      console.error('Rocket PDF conversion failed:', error);

      this.zone.run(() => {
        this.isConverting = false;
        this.conversionProgress = 0;

        this.showMessage(
          error instanceof Error && error.message.includes('50 MB')
            ? 'Conversion failed. The generated PDF would exceed 50 MB.'
            : 'Conversion failed. Try another PNG or JPEG image.',
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

    this.triggerPdfDownload();
  }

  private triggerPdfDownload(): void {
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
    this.conversionProgress = 0;
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
