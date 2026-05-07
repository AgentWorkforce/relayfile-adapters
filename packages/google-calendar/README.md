# @relayfile/adapter-google-calendar

Google Calendar adapter for Relayfile.

This package covers the core pieces needed for a real-time Google Calendar integration in the Relayfile ecosystem:

- deterministic VFS path mapping for calendars and events
- Google push notification normalization
- incremental event sync using Google Calendar sync tokens
- watch channel lifecycle helpers for register, renew, and stop
- event writeback route resolution

## VFS layout

- `/google-calendar/calendars/<calendarId>.json`
- `/google-calendar/calendars/<calendarId>/events/<eventId>.json`

## Notes

The implementation follows the same real-time pattern described in Nango's Google Calendar guide:

1. receive push notifications from `events/watch`
2. treat the webhook as a change signal, not the source of event payloads
3. run incremental `events.list` syncs using `syncToken`
4. renew watch channels before expiration and stop old ones safely

This package is intentionally provider-agnostic at the adapter layer. It expects a Relayfile `ConnectionProvider` implementation, which can be backed by Nango.
