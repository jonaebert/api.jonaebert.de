// Basics
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handle } from 'hono/vercel'

// For Blog
import * as prismic from '@prismicio/client'

// For calendar
import pkg_ical from 'node-ical';
import ical from 'ical-generator';
import pkg_rrule from 'rrule';
const { parseICS } = pkg_ical;
const { rrulestr } = pkg_rrule;

const app = new Hono().basePath('/api')

app.use(
  '/',
  cors({
    origin: ['*'],
    allowHeaders: ['Upgrade-Insecure-Requests'],
    allowMethods: ['GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true
  })
)

app.post('/', async (p) => {
  p.header('Access-Control-Allow-Origin', '*');

  const postAction = p.req.queries('action')?.shift() || null

  switch (postAction) {
    case 'contactForm':
      const contactPrivacy = p.req.queries('privacy')?.shift() || "false"
      if (contactPrivacy == "false") {
        console.error("Privacy policy was not accepted")
        return p.json({
          error: "Privacy policy was not accepted",
          valid: ['true']
        }, 406)
      }

      const contactName = p.req.queries('name')?.shift() || null
      if (contactName == null) {
        console.error("Name was not filled out")
        return p.json({
          error: "Name was not filled out"
        }, 406)
      }

      const contactPronouns = p.req.queries('pronouns')?.shift() || null

      const contactEmail = p.req.queries('email')?.shift() || null
      if (contactEmail == null) {
        console.error("E-Mail was not filled out")
        return p.json({
          error: "E-Mail was not filled out"
        }, 406)
      }

      const contactMessage = p.req.queries('message')?.shift() || null
      if (contactMessage == null) {
        console.error("Message was not filled out")
        return p.json({
          error: "Message was not filled out"
        }, 406)
      }

      try {
        const contactGoogleUrl = `https://docs.google.com/forms/d/e/1FAIpQLSfyYrYSRy_guWcCBKF0wAfPqhZzxQT3ofOjqE8iJLZvqsxQ3w/formResponse?submit=Submit&usp=pp_url&entry.866128707=${contactName}&entry.912764904=${contactPronouns}&entry.1166196952=${contactEmail}&entry.1215915974=${contactMessage}&entry.431160396=${contactPrivacy}`

        const contactRes = await fetch(contactGoogleUrl)
        if (contactRes.status == 200) {
          return p.json({ message: "Message send" })
        } else {
          return p.json(undefined, {status: 500})
        }
      } catch (error) {
        console.error(error);
        return p.json({
          error: 'An error occured',
          debug: {
            error: null
          }
        }, 500);
      }
      break;
  
    default:
      console.error(`Missing or invalid Action: ${postAction}`);
      return p.json({
        error: 'Missing or invalid Action',
        valid: ['contactForm'],
        debug: {
          action: postAction
        }
      }, 406);
      break;
  }
})

app.get('/', async (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  const type = c.req.queries('type')?.shift()

  switch (type) {
    case 'blog':
      let blogPosts = [];
      let blogResp = [];

      const blogMaxItems = c.req.queries('maxitems')?.shift() || '30'
      const blogItemType = c.req.queries('itemtype')?.shift()

      const prismicClient = prismic.createClient('jonasebert', {
        routes: [
          { type: 'article', path: '/blog/:uid' },
        ],
        fetch: fetch
      })

      try {
        switch (blogItemType) {
          case 'all':
            blogResp = await prismicClient.getByType('article', { orderings: { field: 'document.first_publication_date', direction: 'desc' }, pageSize: blogMaxItems});
            blogPosts = blogResp.results;
            break;

          case 'category':
            const blogCategory = c.req.queries('category')?.shift();
            blogResp = await prismicClient.getByTag(blogCategory, { orderings: { field: 'document.first_publication_date', direction: 'desc' }, pageSize: blogMaxItems});
            blogPosts = blogResp.results;
            break;

          case 'post':
            const blogPostId = c.req.queries('postid')?.shift();
            blogResp = await prismicClient.getByUID('article', blogPostId,);
            blogPosts = blogResp;
            break;

          default:
            console.error(`Invalid ItemType: ${c.req.queries('itemtype')?.shift() || null}`);
            return c.json({
              error: 'Invalid or missing ItemType parameter',
              valid: ['all', 'category', 'post'],
              debug: {
                type: c.req.queries('itemtype')?.shift() || null
              }
            }, 500);
          }

        return c.json({
          data: blogPosts
        });
      } catch (error) {
        console.error(error);
        return c.json({
          error: 'An error occured',
          debug: {
            error: null
          }
        }, 500);
      }
      break;

    case 'calendar':
      const calIcalUrl = 'https://wolke.jonaebert.de/remote.php/dav/public-calendars/bn8yfoyg8GEQ6TNN?export';
      const calNow = new Date();
      const calLater = new Date(calNow.getFullYear(), calNow.getMonth()+3, calNow.getDate()+1);
      const calMaxItems = c.req.queries('maxitems')?.shift() || '93';

      let calResp = [];

      try {
        calResp = await fetch(calIcalUrl, {
          headers: {
            'User-Agent': 'Jonas Ebert/1.0'
          }
        });
        const calRespText = await calResp.text();
        const calData = parseICS(calRespText);
        let calEvents = [];

        // Handle (recurrend) events
        for (const calEvent of Object.values(calData)) {
          if (calEvent.type === 'VEVENT') {
              let calOccurrences = [];
              if (calEvent.rrule) {
                  const calRule = rrulestr(calEvent.rrule.toString(), { dtstart: calEvent.start });
                  calOccurrences = calRule.between(calNow, calLater, true).map(calDate => ({
                      ...calEvent,
                      start: calData,
                      end: new Date(calData.getTime() + (calEvent.end - calEvent.start))
                  }));
              } else if ((calEvent.start >= calNow && calEvent.start <= calLater) || (calEvent.end >= calNow && calEvent.end <= calLater)) {
                  calOccurrences.push(calEvent);
              }
              calEvents.push(...calOccurrences);
          }
        }
        // Sort events
        calEvents = calEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

        // Calendar cases
        try {
          const calItemType = c.req.queries('itemtype')?.shift();

          switch (calItemType) {
            case 'all': break;

            case 'single':
              const calSingleItemUID = c.req.queries('id')?.shift();

              if (calSingleItemUID) {
                calEvents = calEvents.filter(event => event.uid === calSingleItemUID);
              } else {
                console.error('[CALENDAR] Missing ID for single event:', calSingleItemUID ? calSingleItemUID : null);
                return c.json({
                  error: 'Missing id for single event',
                  debug: { data: calEvents }
                }, 500);
              }
              if (calEvents == '') {
                console.error('[CALENDAR] Wrong ID for single event:', calSingleItemUID ? calSingleItemUID : null);
                return c.json({
                  error: 'Wrong id for single event',
                  debug: { uid: calSingleItemUID ? calSingleItemUID : null }
                }, 404);
              }
              break;

            default:
              console.error('[CALENDAR] Invalid itemtype:', calItemType ? calItemType : null);
              return c.json({
                error: 'Invalid item type',
                valid: ['all', 'single'],
                debug: { ItemType: calItemType ? calItemType : null }
              }, 400);        
          }
        } catch (error) {
          console.error('[CALENDAR] Error fetching or parsing ICS file:', error);
          return c.json({
            error: 'Failed to fetch or parse ICS file',
            debug: {data: calEvents}
          }, 500);
        }

        // Slice events
        calEvents = calEvents.slice(0, calMaxItems);

        // Customize events
        calEvents = calEvents.map(calEvent => {
          // Extract Teaserimage ID
          const calTeaserImageMatch = calEvent.description?.match(/teaserimage:\s*(.+)/);
          const calTeaserImageId = calTeaserImageMatch ? calTeaserImageMatch[1] : null;
          const calTeaserImageUrl = calTeaserImageId ? `https://wolke.jonaebert.de/index.php/apps/files_sharing/publicpreview/${calTeaserImageId}?x=3440&y=1440&a=true` : null;
          // Extract Teaserimage copyright text
          const calTeaserImageCopyrightTextMatch = calEvent.description?.match(/teasercopyright:\s*(.+)/);
          const calTeaserImageCopyrightText = calTeaserImageCopyrightTextMatch ? calTeaserImageCopyrightTextMatch[1] : null;
          // Extract Teaserimage copyright URI
          const calTeaserImageCopyrighUrlMatch = calEvent.description?.match(/teaserurl:\s*(.+)/);
          const calTeaserImageCopyrighUrl = calTeaserImageCopyrighUrlMatch ? calTeaserImageCopyrighUrlMatch[1] : null;

          // Extrahieren der externen Event URL
          const calEventUrlMatch = calEvent.description?.match(/eventurl:\s*(.+)/);
          const calEventUrl = calEventUrlMatch ? calEventUrlMatch[1] : null;

          // Check if event is happening now
          let calHappeningNow = false;
          if (calEvent.start <= calNow && calEvent.end >= calNow) {
            calHappeningNow = true;
          }

          // Get Description
          const calEventDescription = calEvent.description ? calEvent.description
            .replace(/teaserimage:\s*\S+\n?/, '')
            .replace(/eventurl:\s*\S+\n?/, '')
            .replace(/teasercopyright:\s*.+\n?/, '')
            .replace(/teaserurl:\s*\S+\n?/, '')
            .replace(/\n/g, '<br>')
            : null;

          return {
            id: calEvent.uid ? calEvent.uid : null,
            start: calEvent.start ? calEvent.start : null,
            end: calEvent.end ? calEvent.end : null,
            now: calHappeningNow ? calHappeningNow : false,
            datetype: calEvent.datetype ? calEvent.datetype : null,
            summary: calEvent.summary ? calEvent.summary : null,
            location: calEvent.location ? calEvent.location : null,
            description: calEventDescription,
            state: calEvent.status ? calEvent.status : "TENTATIVE",
            teaserImage: {
              url: calTeaserImageUrl ? calTeaserImageUrl : null,
              copyright: {
                text: calTeaserImageCopyrightText ?  calTeaserImageCopyrightText : null,
                url: calTeaserImageCopyrighUrl ? calTeaserImageCopyrighUrl : null
              }
            },
            url: calEventUrl ? calEventUrl : null
          }
        });

        const download = c.req.queries('download')?.shift() === 'true';
        if (download) {
          const cal = ical();
          calEvents.forEach(event => {
            c.header('Content-Type', 'text/calendar');
            c.header('Content-Disposition', `attachment; filename="${event.id}.ics"`);

            cal.createEvent({
              start: event.start,
              end: event.end,
              summary: event.summary,
              description: event.description,
              location: event.location,
              uid: event.id
            });
          });
          return c.body(cal.toString());
        } else {
          return c.json({
            data: calEvents
          });
        }
      } catch (error) {
        console.error('Error fetching or parsing ICS file:', error);
        return c.json({
          error: 'Failed to fetch or parse ICS file',
          debug: {}
        }, 500);
      }
      break;
  
    default:
      console.error(`Invalid Type: ${c.req.queries('type')?.shift() || null}`);
      return c.json({
        error: 'Invalid or missing Type parameter',
        valid: ['blog', 'calendar'],
        debug: {
          type: c.req.queries('type')?.shift() || null
        }
      }, 500);
  }
})

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;