const express = require('express');
const { Storage } = require('@google-cloud/storage');

const app = express();
const PORT = process.env.PORT || 8080;

// Set up Google Cloud Storage
const storage = new Storage({
    projectId: 'cse4265-2026-103415657', // FIXME: put your projectID here
});
const bucketName = 'cse4265-2026-103415657.appspot.com'; // FIXME: put your bucket name here

const videoBucketName = 'module-3-streaming';

// Route to serve video files from root
app.get('/video/:filename', async (req, res, next) => {
    // TODO:
    // 1. retrieve file name from request parameters
    // 2. retireve the file from storage bucket
    // 3. Pipe the read stream to the response >> https://cloud.google.com/storage/docs/streaming-downloads
    try {
        // 1. Get filename from URL
        const filename = req.params.filename;

        // 2. Get the file from Cloud Storage
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(filename);

        // 3. Set video content type
        res.setHeader('Content-Type', 'video/mp4');

        // 4. Stream the file directly to the HTTP response
        file.createReadStream()
            .on('error', next)
            .pipe(res);

    } catch (error) {
        next(error);
    }
});
app.get('/video/:foldername/:filename', async (req, res, next) => {
    const { foldername, filename } = req.params;
    const objectName = `${foldername}/${filename}`

    try {
        const bucket = storage.bucket(videoBucketName)

        const file = bucket.file(objectName)

        const [exists] = await file.exists()

        if (!exists) return res.status(404).send("File not found")

        res.setHeader("Access-Control-Allow-Origin", "*")

        if (filename.endsWith(".mpd")) {
            res.setHeader("Content-Type", "application/dash+xml");
        } else if (filename.endsWith(".m4s")) {
            res.setHeader("Content-Type", "video/iso.segment");
        }

        file.createReadStream()
            .on("error", (error) => {
                console.error(error);

                if (!res.headersSent) {
                    res.status(500).send("Failed to read video file");
                }
            })
            .pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
})

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});