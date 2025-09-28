# PrivacyPulse Chrome Extension

A privacy-focused browser extension that tracks your digital footprint without collecting sensitive personal data.

## Features

- **Screen Time Tracking**: Monitor time spent on websites
- **Form Detection**: Detect when you fill out forms (metadata only, no sensitive data)
- **Risk Assessment**: Get privacy risk scores for websites
- **Offline Support**: Queue data when offline, sync when online
- **Privacy Controls**: Granular settings for what to track
- **Data Export**: Download your privacy data for analysis

## Installation

### For Development/Testing

1. **Load the Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `Extenstion` folder

2. **Configure Backend**:
   - The extension is pre-configured to use the production backend
   - Backend URL: `https://privacypulse-9xnj.onrender.com`
   - Frontend URL: `https://privacy.pulse-pr5m.onrender.com`

### For Production (Chrome Web Store)

1. **Prepare for Publishing**:
   - Zip the `Extenstion` folder (excluding `README.md`)
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   - Upload the zip file
   - Fill out the listing details
   - Set visibility to "Unlisted" for private distribution

2. **Required Information**:
   - **Name**: PrivacyPulse
   - **Description**: Privacy-focused browsing analytics
   - **Category**: Productivity
   - **Privacy Policy**: Required (link to your privacy policy)
   - **Screenshots**: Show the popup and options page
   - **Icons**: 16x16, 48x48, 128x128 pixels

## Usage

### First Time Setup

1. **Install the Extension**: Follow installation steps above
2. **Open Options**: Right-click extension icon → "Options"
3. **Log In**: Enter your email and password
4. **Configure Settings**: Choose what to track
5. **Enable Tracking**: Toggle "Enable Tracking" to ON

### Daily Use

- **Popup**: Click the extension icon to see current site info
- **Dashboard**: Click "Go to Dashboard" for detailed analytics
- **Settings**: Right-click extension → "Options" to change preferences

### Privacy Controls

- **Enable Tracking**: Master switch for all tracking
- **Form Detection**: Detect form interactions (metadata only)
- **Screen Time**: Track time spent on websites
- **Data Export**: Download your data anytime
- **Clear Data**: Remove all local data

## Architecture

### Components

1. **Manifest V3**: Modern Chrome extension architecture
2. **Content Script**: Injected into web pages to detect forms
3. **Background Service Worker**: Handles data collection and API calls
4. **Popup**: Quick view of current site status
5. **Options Page**: Full settings and authentication

### Data Flow

```
Web Page → Content Script → Background Worker → Backend API
                ↓
            Local Storage (offline queue)
```

### Privacy by Design

- **No Sensitive Data**: Only metadata (hostname, timestamps, field types)
- **Local Processing**: Form detection happens in browser
- **Encrypted Transport**: All API calls use HTTPS
- **User Control**: Granular privacy settings
- **Data Export**: Users can download their data

## Development

### File Structure

```
Extenstion/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (main logic)
├── content.js            # Content script (form detection)
├── content-bridge.js     # Bridge for frontend communication
├── popup.html            # Popup UI
├── popup.js              # Popup logic
├── options.html          # Options page UI
├── options.js            # Options page logic
└── README.md             # This file
```

### Key Features

#### Offline Queue
- Stores failed API calls locally
- Retries with exponential backoff
- Processes queue on startup and periodic alarms

#### Form Detection
- Detects form fields by type and name
- Only collects boolean flags (no actual values)
- Supports both traditional forms and SPA interactions

#### Screen Time Tracking
- Uses Chrome's idle detection
- Tracks active time only (not idle time)
- Handles tab switching and window focus

#### Authentication
- JWT-based authentication
- Token stored securely in extension storage
- Automatic token refresh on API calls

### Environment Configuration

The extension uses these URLs:
- **Backend**: `https://privacypulse-9xnj.onrender.com`
- **Frontend**: `https://privacy.pulse-pr5m.onrender.com`

To change these, update the `API_BASE` constant in:
- `background.js`
- `popup.js`
- `options.js`

## Privacy & Compliance

### Data Collection

**What we collect**:
- Website hostnames and paths
- Timestamps of visits and form interactions
- Field types detected (email, phone, etc.) - **NOT the actual values**
- Screen time per website
- Risk assessment scores

**What we DON'T collect**:
- Actual form input values
- Personal information
- Browsing history details
- Cookies or session data

### User Rights

- **Access**: View all collected data via dashboard
- **Export**: Download data in JSON format
- **Delete**: Clear all local data
- **Control**: Granular privacy settings
- **Transparency**: Open source code

### Compliance

- **GDPR**: Right to access, export, and delete data
- **CCPA**: Clear data collection disclosure
- **Chrome Web Store**: Follows all privacy policies

## Troubleshooting

### Common Issues

1. **Extension not tracking**:
   - Check if "Enable Tracking" is ON in options
   - Verify you're logged in
   - Check browser console for errors

2. **Data not syncing**:
   - Check internet connection
   - Verify backend is accessible
   - Check authentication status

3. **Forms not detected**:
   - Some SPA sites may not trigger form events
   - Check if "Form Detection" is enabled
   - Try refreshing the page

### Debug Mode

1. Open Chrome DevTools
2. Go to Extensions tab
3. Click "Inspect views: background page"
4. Check console for error messages

### Support

- **Issues**: Report bugs via GitHub issues
- **Questions**: Contact via dashboard
- **Privacy**: Review privacy policy on website

## Version History

- **v1.0.0**: Initial release with core tracking features
- **v1.1.0**: Added offline queue and retry logic
- **v1.2.0**: Enhanced privacy controls and data export
- **v1.3.0**: Improved form detection and SPA support

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Security

- All API calls use HTTPS
- JWT tokens are stored securely
- No sensitive data is collected or transmitted
- Regular security audits and updates
