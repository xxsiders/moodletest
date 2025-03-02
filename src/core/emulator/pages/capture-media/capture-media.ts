// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { IonicPage, ViewController, NavParams, Platform } from 'ionic-angular';
import { CoreApp } from '@providers/app';
import { CoreFileProvider } from '@providers/file';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreMimetypeUtils } from '@providers/utils/mimetype';
import { CoreTextUtilsProvider } from '@providers/utils/text';
import { CoreTimeUtilsProvider } from '@providers/utils/time';

import { FileEntry } from '@ionic-native/file';
import { MediaFile } from '@ionic-native/media-capture';
import { Media, MediaObject } from '@ionic-native/media';

/**
 * Page to capture media in browser or desktop, or to capture audio in mobile devices.
 */
@IonicPage({ segment: 'core-emulator-capture-media' })
@Component({
    selector: 'page-core-emulator-capture-media',
    templateUrl: 'capture-media.html',
})
export class CoreEmulatorCaptureMediaPage implements OnInit, OnDestroy {
    @ViewChild('streamVideo') streamVideo: ElementRef;
    @ViewChild('previewVideo') previewVideo: ElementRef;
    @ViewChild('imgCanvas') imgCanvas: ElementRef;
    @ViewChild('previewImage') previewImage: ElementRef;
    @ViewChild('streamAudio') streamAudio: ElementRef;
    @ViewChild('previewAudio') previewAudio: ElementRef;

    title: string; // The title of the page.
    isAudio: boolean; // Whether it should capture audio.
    isVideo: boolean; // Whether it should capture video.
    isImage: boolean; // Whether it should capture image.
    readyToCapture: boolean; // Whether it's ready to capture.
    hasCaptured: boolean; // Whether it has captured something.
    isCapturing: boolean; // Whether it's capturing.
    maxTime: number; // The max time to capture.
    resetChrono: boolean; // Boolean to reset the chrono.
    isCordovaAudioCapture: boolean; // Whether it's capturing audio using Cordova plugin.

    protected type: string; // The type to capture: audio, video, image, captureimage.
    protected isCaptureImage: boolean; // To identify if it's capturing an image using media capture plugin (instead of camera).
    protected returnDataUrl: boolean; // Whether it should return a data img. Only if isImage.
    protected facingMode: string; // Camera facing mode.
    protected mimetype: string;
    protected extension: string;
    protected window: any; // Cast window to "any" because some of the properties used aren't in the window spec.
    protected mediaRecorder; // To record video/audio.
    protected audioDrawer; // To start/stop the display of audio sound.
    protected quality; // Image only.
    protected previewMedia: HTMLAudioElement | HTMLVideoElement; // The element to preview the audio/video captured.
    protected mediaBlob: Blob; // A Blob where the captured data is stored.
    protected localMediaStream: MediaStream;

    // Variables for Cordova Media capture.
    protected mediaFile: MediaObject;
    protected filePath: string;
    protected fileEntry: FileEntry;

    constructor(protected viewCtrl: ViewController,
            params: NavParams,
            protected domUtils: CoreDomUtilsProvider,
            protected timeUtils: CoreTimeUtilsProvider,
            protected fileProvider: CoreFileProvider,
            protected textUtils: CoreTextUtilsProvider,
            protected cdr: ChangeDetectorRef,
            protected plaform: Platform,
            protected media: Media) {
        this.window = window;
        this.type = params.get('type');
        this.maxTime = params.get('maxTime');
        this.facingMode = params.get('facingMode') || 'environment';
        this.mimetype = params.get('mimetype');
        this.extension = params.get('extension');
        this.quality = params.get('quality') || 0.92;
        this.returnDataUrl = !!params.get('returnDataUrl');
    }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        this.initVariables();

        if (this.isCordovaAudioCapture) {
            this.initCordovaMediaPlugin();
        } else {
            this.initHtmlCapture();
        }
    }

    /**
     * Init recording with Cordova media plugin.
     *
     * @return Promise resolved when ready.
     */
    protected async initCordovaMediaPlugin(): Promise<void> {
        this.filePath = this.getFilePath();
        let absolutePath = this.textUtils.concatenatePaths(this.fileProvider.getBasePathInstant(), this.filePath);

        if (this.plaform.is('ios')) {
            // In iOS we need to remove the file:// part.
            absolutePath = absolutePath.replace(/^file:\/\//, '');
        }

        try {
            // First create the file.
            this.fileEntry = await this.fileProvider.createFile(this.filePath);

            // Now create the media instance.
            this.mediaFile = this.media.create(absolutePath);
            this.readyToCapture = true;
            this.previewMedia = this.previewAudio.nativeElement;
        } catch (error) {
            this.dismissWithError(-1, error.message || error);
        }
    }

    /**
     * Init HTML recorder, for desktop apps.
     *
     * @return Promise resolved when done.
     */
    protected initHtmlCapture(): Promise<void> {
        const constraints = {
            video: this.isAudio ? false : { facingMode: this.facingMode },
            audio: !this.isImage
        };

        return navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            let chunks = [];
            this.localMediaStream = stream;

            if (!this.isImage) {
                if (this.isVideo) {
                    this.previewMedia = this.previewVideo.nativeElement;
                } else {
                    this.previewMedia = this.previewAudio.nativeElement;
                    this.initAudioDrawer(this.localMediaStream);
                    this.audioDrawer.start();
                }

                this.mediaRecorder = new this.window.MediaRecorder(this.localMediaStream, { mimeType: this.mimetype });

                // When video or audio is recorded, add it to the list of chunks.
                this.mediaRecorder.ondataavailable = (e): void => {
                    if (e.data.size > 0) {
                        chunks.push(e.data);
                    }
                };

                // When recording stops, create a Blob element with the recording and set it to the video or audio.
                this.mediaRecorder.onstop = (): void => {
                    this.mediaBlob = new Blob(chunks);
                    chunks = [];

                    this.previewMedia.src = window.URL.createObjectURL(this.mediaBlob);
                };
            }

            if (this.isImage || this.isVideo) {
                let hasLoaded = false,
                    waitTimeout;

                // Listen for stream ready to display the stream.
                this.streamVideo.nativeElement.onloadedmetadata = (): void => {
                    if (hasLoaded) {
                        // Already loaded or timeout triggered, stop.
                        return;
                    }

                    hasLoaded = true;
                    clearTimeout(waitTimeout);
                    this.readyToCapture = true;
                    this.streamVideo.nativeElement.onloadedmetadata = null;
                    // Force change detection. Angular doesn't detect these async operations.
                    this.cdr.detectChanges();
                };

                // Set the stream as the source of the video.
                this.streamVideo.nativeElement.src = window.URL.createObjectURL(this.localMediaStream);

                // If stream isn't ready in a while, show error.
                waitTimeout = setTimeout(() => {
                    if (!hasLoaded) {
                        // Show error.
                        hasLoaded = true;
                        this.dismissWithError(-1, 'Cannot connect to webcam.');
                    }
                }, 10000);
            } else {
                // It's ready to capture.
                this.readyToCapture = true;
            }
        }).catch((error) => {
            this.dismissWithError(-1, error.message || error);
        });
    }

    /**
     * Initialize the audio drawer. This code has been extracted from MDN's example on MediaStream Recording:
     * https://github.com/mdn/web-dictaphone
     *
     * @param stream Stream returned by getUserMedia.
     */
    protected initAudioDrawer(stream: MediaStream): void {
        let skip = true,
            running = false;

        const audioCtx = new (this.window.AudioContext || this.window.webkitAudioContext)(),
            canvasCtx = this.streamAudio.nativeElement.getContext('2d'),
            source = audioCtx.createMediaStreamSource(stream),
            analyser = audioCtx.createAnalyser(),
            bufferLength = analyser.frequencyBinCount,
            dataArray = new Uint8Array(bufferLength),
            width = this.streamAudio.nativeElement.width,
            height = this.streamAudio.nativeElement.height,
            drawAudio = (): void => {
                if (!running) {
                    return;
                }

                // Update the draw every animation frame.
                requestAnimationFrame(drawAudio);

                // Skip half of the frames to improve performance, shouldn't affect the smoothness.
                skip = !skip;
                if (skip) {
                    return;
                }

                const sliceWidth = width / bufferLength;
                let x = 0;

                analyser.getByteTimeDomainData(dataArray);

                canvasCtx.fillStyle = 'rgb(200, 200, 200)';
                canvasCtx.fillRect(0, 0, width, height);

                canvasCtx.lineWidth = 1;
                canvasCtx.strokeStyle = 'rgb(0, 0, 0)';

                canvasCtx.beginPath();

                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0,
                        y = v * height / 2;

                    if (i === 0) {
                        canvasCtx.moveTo(x, y);
                    } else {
                        canvasCtx.lineTo(x, y);
                    }

                    x += sliceWidth;
                }

                canvasCtx.lineTo(width, height / 2);
                canvasCtx.stroke();
            };

        analyser.fftSize = 2048;
        source.connect(analyser);

        this.audioDrawer = {
            start: (): void => {
                if (running) {
                    return;
                }

                running = true;
                drawAudio();
            },
            stop: (): void => {
                running = false;
            }
        };
    }

    /**
     * Initialize some variables based on the params.
     */
    protected initVariables(): void {
        if (this.type == 'captureimage') {
            this.isCaptureImage = true;
            this.type = 'image';
        }

        // Initialize some data based on the type of media to capture.
        if (this.type == 'video') {
            this.isVideo = true;
            this.title = 'core.capturevideo';
        } else if (this.type == 'audio') {
            this.isAudio = true;
            this.title = 'core.captureaudio';
        } else if (this.type == 'image') {
            this.isImage = true;
            this.title = 'core.captureimage';
        }

        this.isCordovaAudioCapture = CoreApp.instance.isMobile() && this.isAudio;

        if (this.isCordovaAudioCapture) {
            this.extension = this.plaform.is('ios') ? 'wav' : 'aac';
            this.returnDataUrl = false;
        }
    }

    /**
     * Main action clicked: record or stop recording.
     */
    actionClicked(): void {
        if (this.isCapturing) {
            // It's capturing, stop.
            this.stopCapturing();
            this.cdr.detectChanges();
        } else {
            if (!this.isImage) {
                // Start the capture.
                this.isCapturing = true;
                this.resetChrono = false;

                if (this.isCordovaAudioCapture) {
                    this.mediaFile.startRecord();
                    this.previewMedia.src = '';
                } else {
                    this.mediaRecorder && this.mediaRecorder.start();
                }

                this.cdr.detectChanges();
            } else {
                // Get the image from the video and set it to the canvas, using video width/height.
                const width = this.streamVideo.nativeElement.videoWidth,
                    height = this.streamVideo.nativeElement.videoHeight,
                    loadingModal = this.domUtils.showModalLoading();

                this.imgCanvas.nativeElement.width = width;
                this.imgCanvas.nativeElement.height = height;
                this.imgCanvas.nativeElement.getContext('2d').drawImage(this.streamVideo.nativeElement, 0, 0, width, height);

                // Convert the image to blob and show it in an image element.
                this.imgCanvas.nativeElement.toBlob((blob) => {
                    loadingModal.dismiss();

                    this.mediaBlob = blob;
                    this.previewImage.nativeElement.setAttribute('src', window.URL.createObjectURL(this.mediaBlob));
                    this.hasCaptured = true;
                }, this.mimetype, this.quality);
            }
        }
    }

    /**
     * User cancelled.
     */
    cancel(): void {
        // Send a "cancelled" error like the Cordova plugin does.
        this.dismissWithError(3, 'Canceled.', 'Camera cancelled');

        if (this.isCordovaAudioCapture) {
            // Delete the tmp file.
            this.fileProvider.removeFile(this.filePath);
        }
    }

    /**
     * Discard the captured media.
     */
    discard(): void {
        this.previewMedia && this.previewMedia.pause();
        this.streamVideo && this.streamVideo.nativeElement.play();
        this.audioDrawer && this.audioDrawer.start();

        this.hasCaptured = false;
        this.isCapturing = false;
        this.resetChrono = true;
        delete this.mediaBlob;
        this.cdr.detectChanges();
    }

    /**
     * Close the modal, returning some data (success).
     *
     * @param data Data to return.
     */
    dismissWithData(data: any): void {
        this.viewCtrl.dismiss(data, 'success');
    }

    /**
     * Close the modal, returning an error.
     *
     * @param code Error code. Will not be used if it's a Camera capture.
     * @param message Error message.
     * @param cameraMessage A specific message to use if it's a Camera capture. If not set, message will be used.
     */
    dismissWithError(code: number, message: string, cameraMessage?: string): void {
        const isCamera = this.isImage && !this.isCaptureImage,
            error = isCamera ? (cameraMessage || message) : { code: code, message: message };
        this.viewCtrl.dismiss(error, 'error');
    }

    /**
     * Done capturing, write the file.
     */
    async done(): Promise<void> {
        if (this.returnDataUrl) {
            // Return the image as a base64 string.
            this.dismissWithData(this.imgCanvas.nativeElement.toDataURL(this.mimetype, this.quality));

            return;
        }

        if (!this.mediaBlob && !this.isCordovaAudioCapture) {
            // Shouldn't happen.
            this.domUtils.showErrorModal('Please capture the media first.');

            return;
        }

        let fileEntry = this.fileEntry;
        const loadingModal = this.domUtils.showModalLoading();

        try {
            if (!this.isCordovaAudioCapture) {
                // Capturing in browser. Write the blob in a file.
                if (!this.mediaBlob) {
                    // Shouldn't happen.
                    throw new Error('Please capture the media first.');
                }

                fileEntry = await this.fileProvider.writeFile(this.getFilePath(), this.mediaBlob);
            }

            if (this.isImage && !this.isCaptureImage) {
                this.dismissWithData(fileEntry.toURL());
            } else {
                // The capture plugin should return a MediaFile, not a FileEntry. Convert it.
                const metadata = await this.fileProvider.getMetadata(fileEntry);

                let mimetype = null;
                if (this.extension) {
                    mimetype = CoreMimetypeUtils.instance.getMimeType(this.extension);
                }

                const mediaFile: MediaFile = {
                    name: fileEntry.name,
                    fullPath: fileEntry.nativeURL || fileEntry.fullPath,
                    type: mimetype,
                    lastModifiedDate: metadata.modificationTime,
                    size: metadata.size,
                    getFormatData: (successFn, errorFn): void => {
                        // Nothing to do.
                    }
                };

                this.dismissWithData([mediaFile]);
            }
        } catch (err) {
            this.domUtils.showErrorModal(err);
        } finally {
            loadingModal.dismiss();
        }
    }

    /**
     * Get path to the file where the media will be stored.
     *
     * @return Path.
     */
    protected getFilePath(): string {
        const fileName = this.type + '_' + this.timeUtils.readableTimestamp() + '.' + this.extension;

        return this.textUtils.concatenatePaths(CoreFileProvider.TMPFOLDER, 'media/' + fileName);
    }

    /**
     * Stop capturing. Only for video and audio.
     */
    stopCapturing(): void {
        this.isCapturing = false;
        this.hasCaptured = true;

        if (this.isCordovaAudioCapture) {
            this.mediaFile.stopRecord();
            this.previewMedia.src = this.fileProvider.convertFileSrc(this.fileEntry.toURL());
        } else {
            this.streamVideo && this.streamVideo.nativeElement.pause();
            this.audioDrawer && this.audioDrawer.stop();
            this.mediaRecorder && this.mediaRecorder.stop();
        }
    }

    /**
     * Page destroyed.
     */
    ngOnDestroy(): void {
        this.mediaFile && this.mediaFile.release();

        if (this.localMediaStream) {
            const tracks = this.localMediaStream.getTracks();
            tracks.forEach((track) => {
                track.stop();
            });
        }
        this.streamVideo && this.streamVideo.nativeElement.pause();
        this.previewMedia && this.previewMedia.pause();
        this.audioDrawer && this.audioDrawer.stop();
        delete this.mediaBlob;
    }
}
