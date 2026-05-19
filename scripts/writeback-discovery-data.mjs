export const adapters = [
  {
    slug: 'asana',
    title: 'Asana adapter',
    overview:
      'The Asana adapter exposes task, project, section, and workspace records under `/asana`, with writeback routes for creating tasks, projects, and sections plus updating existing records.',
    readPaths: [
      ['/asana/tasks/<taskId>.json', 'Task records.'],
      ['/asana/projects/<projectId>.json', 'Project records.'],
      ['/asana/projects/<projectId>/sections/<sectionId>.json', 'Project-scoped section records.'],
      ['/asana/workspaces/<workspaceId>.json', 'Workspace records.'],
    ],
    endpoints: [
      endpoint('/asana/tasks/new.json', 'Create Asana task', 'Creates an Asana task.', ['name'], {
        name: str('Task name.'),
        workspace: str('Workspace gid for the new task.'),
        assignee: str('User gid or `me` to assign the task.'),
        assignee_status: str('Assignee status such as inbox, later, upcoming, or today.'),
        notes: str('Plain-text task notes.'),
        html_notes: str('HTML task notes.'),
        due_on: str('Due date in YYYY-MM-DD form.', 'date'),
        due_at: str('Due timestamp in ISO 8601 form.', 'date-time'),
        start_on: str('Start date in YYYY-MM-DD form.', 'date'),
        start_at: str('Start timestamp in ISO 8601 form.', 'date-time'),
        completed: bool('Whether the task starts completed.'),
        projects: arr(str('Project gid.'), 'Project gids to add the task to.'),
        followers: arr(str('Follower user gid.'), 'Follower user gids.'),
        tags: arr(str('Tag gid.'), 'Tag gids to attach.'),
        custom_fields: obj('Asana custom field gid to value map.'),
        parent: str('Parent task gid for subtasks.'),
      }, { name: 'Replace example task name', workspace: '1200000000000000' }),
      endpoint('/asana/projects/new.json', 'Create Asana project', 'Creates an Asana project.', ['name'], {
        name: str('Project name.'),
        workspace: str('Workspace gid for the project.'),
        team: str('Team gid for the project.'),
        notes: str('Project notes.'),
        color: str('Asana project color name.'),
        default_view: str('Initial project view.'),
        due_on: str('Project due date in YYYY-MM-DD form.', 'date'),
        start_on: str('Project start date in YYYY-MM-DD form.', 'date'),
        public: bool('Whether the project is public to the workspace.'),
        archived: bool('Whether the project starts archived.'),
        custom_fields: obj('Asana custom field gid to value map.'),
      }, { name: 'Replace example project name', workspace: '1200000000000000' }),
      endpoint('/asana/sections/new.json', 'Create Asana section', 'Creates an Asana section when the project gid is supplied in the document.', ['name', 'project'], {
        name: str('Section name.'),
        project: str('Project gid that will contain the section.'),
      }, { name: 'Replace example section name', project: '1200000000000000' }),
      endpoint('/asana/projects/{projectId}/sections/new.json', 'Create Asana project section', 'Creates a section inside the project named by the path.', ['name'], {
        name: str('Section name.'),
      }, { name: 'Replace example section name' }),
    ],
  },
  {
    slug: 'clickup',
    title: 'ClickUp adapter',
    overview:
      'The ClickUp adapter exposes spaces, folders, lists, tasks, and comments under `/clickup`, with writeback routes for creating tasks, lists, folders, and task comments.',
    readPaths: [
      ['/clickup/spaces/<spaceId>.json', 'Space records.'],
      ['/clickup/folders/<folderId>.json', 'Folder records.'],
      ['/clickup/lists/<listId>.json', 'List records.'],
      ['/clickup/tasks/<taskId>.json', 'Task records.'],
    ],
    endpoints: [
      endpoint('/clickup/tasks/{taskId}/comments/new.json', 'Create ClickUp task comment', 'Adds a comment to a ClickUp task.', ['comment_text'], {
        comment_text: str('Comment body. A plain string body is also accepted by the resolver.'),
      }, { comment_text: 'Replace example comment text.' }),
      endpoint('/clickup/lists/{listId}/tasks/new.json', 'Create ClickUp task', 'Creates a task in a ClickUp list.', ['name'], clickupTaskProps(), { name: 'Replace example task name' }),
      endpoint('/clickup/folders/{folderId}/lists/new.json', 'Create ClickUp folder list', 'Creates a list inside a ClickUp folder.', ['name'], clickupListProps(), { name: 'Replace example list name' }),
      endpoint('/clickup/spaces/{spaceId}/lists/new.json', 'Create ClickUp space list', 'Creates a folderless list inside a ClickUp space.', ['name'], clickupListProps(), { name: 'Replace example list name' }),
      endpoint('/clickup/spaces/{spaceId}/folders/new.json', 'Create ClickUp folder', 'Creates a folder inside a ClickUp space.', ['name'], {
        name: str('Folder name.'),
      }, { name: 'Replace example folder name' }),
    ],
  },
  {
    slug: 'confluence',
    title: 'Confluence adapter',
    overview:
      'The Confluence adapter exposes spaces and pages under `/confluence`, with writeback routes for creating, updating, and deleting pages.',
    readPaths: [
      ['/confluence/spaces/<spaceIdOrKey>.json', 'Space records.'],
      ['/confluence/pages/<pageId>.json', 'Flat page records.'],
      ['/confluence/spaces/<spaceIdOrKey>/pages/<pageId>.json', 'Space-scoped page records.'],
    ],
    endpoints: [
      endpoint('/confluence/pages/new.json', 'Create Confluence page', 'Creates a Confluence page when `spaceId` is supplied in the document.', ['title', 'spaceId', 'body'], confluencePageProps(), { title: 'Replace example page title', spaceId: '12345', body: '<p>Replace example page body.</p>' }),
      endpoint('/confluence/spaces/{spaceIdOrKey}/pages/new.json', 'Create Confluence space page', 'Creates a Confluence page in the space named by the path.', ['title', 'body'], confluencePageProps({ includeSpaceId: false }), { title: 'Replace example page title', body: '<p>Replace example page body.</p>' }),
    ],
  },
  {
    slug: 'github',
    title: 'GitHub adapter',
    overview:
      'The GitHub adapter exposes repository pull requests, issues, reviews, comments, commits, files, and checks under `/github`, with writeback support for creating and updating issues, creating and updating issue comments, and submitting pull request reviews.',
    readPaths: [
      ['/github/repos/<owner>/<repo>/pulls/<pullNumber>/meta.json', 'Pull request metadata.'],
      ['/github/repos/<owner>/<repo>/pulls/<pullNumber>/files/<path>', 'Pull request file records.'],
      ['/github/repos/<owner>/<repo>/issues/<issueNumber>/meta.json', 'Issue metadata.'],
      ['/github/repos/<owner>/<repo>/commits/<sha>/metadata.json', 'Commit metadata.'],
    ],
    endpoints: [
      contractEndpoint('/github/repos/{owner}/{repo}/issues/new.json', 'issues/create', { title: 'Replace example issue title', body: 'Replace example issue body.', labels: ['triage'] }, {
        title: 'Create GitHub issue',
        description: 'Creates a GitHub issue.',
        schemaOverrides: {
          properties: {
            milestone: {
              description: 'Milestone number or title.',
            },
            state: en(['open', 'closed'], 'Issue state when updating an existing issue.'),
          },
        },
      }),
      contractEndpoint('/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/new.json', 'issues/create-comment', { body: 'Replace example comment body.' }, {
        title: 'Create GitHub issue comment',
        description: 'Creates or updates a GitHub issue comment.',
      }),
      contractEndpoint('/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/new.json', 'pulls/create-review', { event: 'COMMENT', body: 'Replace example review body.', comments: [] }, {
        title: 'Submit GitHub pull request review',
        description: 'Submits a pull request review with optional inline comments.',
        schemaOverrides: {
          required: ['event', 'body', 'comments'],
          properties: {
            comments: {
              items: {
                type: 'object',
                required: ['path', 'line', 'body'],
                properties: {
                  line: int('Line number on the selected side.', { minimum: 1 }),
                  side: en(['LEFT', 'RIGHT'], 'Diff side for the comment. Defaults to RIGHT.'),
                  start_line: int('First line for a multi-line comment.', { minimum: 1 }),
                  start_side: en(['LEFT', 'RIGHT'], 'Diff side for the first line of a multi-line comment.'),
                  suggestion: str('Optional suggested replacement text appended to the comment body.'),
                },
                additionalProperties: true,
              },
            },
            metadata: obj('Optional submission metadata.', {
              commitSha: str('Commit SHA to anchor the review to.'),
              connectionId: str('Relayfile connection id override.'),
              providerConfigKey: str('GitHub provider config key override.'),
            }),
          },
        },
      }),
    ],
  },
  {
    slug: 'gitlab',
    title: 'GitLab adapter',
    overview:
      'The GitLab adapter exposes projects, merge requests, discussions, issues, commits, pipelines, jobs, deployments, and tags under `/gitlab`, with writeback routes for merge request discussions and issue notes.',
    readPaths: [
      ['/gitlab/projects/<namespace>/<project>/merge_requests/<iid>__<slug>/meta.json', 'Merge request metadata.'],
      ['/gitlab/projects/<namespace>/<project>/merge_requests/<iid>__<slug>/discussions/<discussionId>.json', 'Merge request discussions.'],
      ['/gitlab/projects/<namespace>/<project>/issues/<iid>__<slug>/meta.json', 'Issue metadata.'],
      ['/gitlab/projects/<namespace>/<project>/pipelines/<pipelineId>__<ref>/jobs/<jobId>.json', 'Pipeline job records.'],
      ['/gitlab/projects/<namespace>/<project>/deployments/<deploymentId>/meta.json', 'Deployment records.'],
      ['/gitlab/projects/<namespace>/<project>/tags/<tagRef>/meta.json', 'Tag records.'],
    ],
    endpoints: [
      endpoint('/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/discussions/new.json', 'Create GitLab merge request discussion', 'Creates a discussion on a merge request.', ['body'], gitlabDiscussionProps(), { body: 'Replace example discussion body.' }),
      endpoint('/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/comments/new.json', 'Create GitLab issue note', 'Creates a note on an issue.', ['body'], gitlabIssueNoteProps(), { body: 'Replace example note body.' }),
    ],
  },
  {
    slug: 'hubspot',
    title: 'HubSpot adapter',
    overview:
      'The HubSpot adapter exposes CRM contacts, companies, deals, and tickets under `/hubspot`, with writeback routes for creating and updating those CRM objects.',
    readPaths: [
      ['/hubspot/contacts/<contactId>.json', 'Contact records.'],
      ['/hubspot/companies/<companyId>.json', 'Company records.'],
      ['/hubspot/deals/<dealId>.json', 'Deal records.'],
      ['/hubspot/tickets/<ticketId>.json', 'Ticket records.'],
    ],
    endpoints: [
      hubspotEndpoint('/hubspot/contacts/new.json', 'Create HubSpot contact', 'Creates a HubSpot contact.', { email: 'ada@example.com', firstname: 'Ada' }),
      hubspotEndpoint('/hubspot/companies/new.json', 'Create HubSpot company', 'Creates a HubSpot company.', { name: 'Example Inc', domain: 'example.com' }),
      hubspotEndpoint('/hubspot/deals/new.json', 'Create HubSpot deal', 'Creates a HubSpot deal.', { dealname: 'Example deal', amount: '1000' }),
      hubspotEndpoint('/hubspot/tickets/new.json', 'Create HubSpot ticket', 'Creates a HubSpot ticket.', { subject: 'Example ticket', content: 'Replace example ticket content.' }),
    ],
  },
  {
    slug: 'intercom',
    title: 'Intercom adapter',
    overview:
      'The Intercom adapter exposes conversations, contacts, and companies under `/intercom`, with writeback routes for creating and updating those objects.',
    readPaths: [
      ['/intercom/conversations/<conversationId>.json', 'Conversation records.'],
      ['/intercom/contacts/<contactId>.json', 'Contact records.'],
      ['/intercom/companies/<companyId>.json', 'Company records.'],
    ],
    endpoints: [
      endpoint('/intercom/conversations/new.json', 'Create Intercom conversation', 'Creates an Intercom conversation.', [], {
        from: obj('Message author. Include the shape required by Intercom for the selected source type.'),
        body: str('Conversation body.'),
        message_type: str('Conversation message type.'),
      }, { from: { type: 'user', id: 'replace-user-id' }, body: 'Replace example conversation body.' }),
      endpoint('/intercom/contacts/new.json', 'Create Intercom contact', 'Creates an Intercom contact.', [], {
        role: str('Contact role, such as user or lead.'),
        email: str('Contact email address.', 'email'),
        name: str('Contact display name.'),
        external_id: str('External id for upsert-style workflows.'),
        phone: str('Contact phone number.'),
      }, { role: 'user', email: 'ada@example.com' }),
      endpoint('/intercom/companies/new.json', 'Create Intercom company', 'Creates an Intercom company.', [], {
        company_id: str('Stable company id.'),
        name: str('Company name.'),
        plan: str('Plan name.'),
        website: str('Company website URL.', 'uri'),
        monthly_spend: num('Monthly spend value.'),
      }, { company_id: 'example-company', name: 'Example Inc' }),
    ],
  },
  {
    slug: 'jira',
    title: 'Jira adapter',
    overview:
      'The Jira adapter exposes issues, comments, projects, and sprints under `/jira`, with writeback routes for creating issues, projects, issue comments, and issue transitions.',
    readPaths: [
      ['/jira/issues/<issueIdOrKey>.json', 'Issue records.'],
      ['/jira/issues/<issueIdOrKey>/comments/<commentId>.json', 'Issue comment records.'],
      ['/jira/projects/<projectIdOrKey>.json', 'Project records.'],
      ['/jira/sprints/<sprintId>.json', 'Sprint records.'],
    ],
    endpoints: [
      endpoint('/jira/issues/{issueIdOrKey}/comments/new.json', 'Create Jira issue comment', 'Adds a comment to a Jira issue.', ['body'], {
        body: {
          description: 'Jira rich-text document body, or plain string body.',
          oneOf: [
            { type: 'object', additionalProperties: true },
            { type: 'string' },
          ],
        },
      }, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replace example comment text.' }] }] } }),
      endpoint('/jira/issues/new.json', 'Create Jira issue', 'Creates a Jira issue.', ['fields'], {
        fields: obj('Jira issue fields.', {
          project: obj('Project object. Usually includes `key` or `id`.'),
          summary: str('Issue summary.'),
          issuetype: obj('Issue type object. Usually includes `name` or `id`.'),
          description: obj('Jira rich-text description document.'),
          priority: obj('Priority object. Usually includes `name` or `id`.'),
          labels: arr(str('Issue label.'), 'Issue labels.'),
        }, { required: ['project', 'summary', 'issuetype'] }),
      }, { fields: { project: { key: 'PROJ' }, summary: 'Replace example summary', issuetype: { name: 'Task' } } }),
      endpoint('/jira/issues/{issueIdOrKey}/transitions/new.json', 'Transition Jira issue', 'Transitions a Jira issue to another workflow state.', ['transition'], {
        transition: obj('Jira transition.', {
          id: str('Transition id.'),
        }, { required: ['id'] }),
      }, { transition: { id: '31' } }),
      endpoint('/jira/projects/new.json', 'Create Jira project', 'Creates a Jira project.', ['key', 'name', 'projectTypeKey', 'leadAccountId'], {
        key: str('Project key.'),
        name: str('Project name.'),
        projectTypeKey: str('Project type key such as software, business, or service_desk.'),
        leadAccountId: str('Jira account id for the project lead.'),
        description: str('Project description.'),
        url: str('Project URL.', 'uri'),
        assigneeType: str('Default assignee type.'),
      }, { key: 'EX', name: 'Example Project', projectTypeKey: 'software', leadAccountId: 'replace-account-id' }),
    ],
  },
  {
    slug: 'linear',
    title: 'Linear adapter',
    overview:
      'The Linear adapter exposes teams, issues, users, comments, projects, cycles, milestones, and roadmaps under `/linear`, with writeback routes for creating issues and comments.',
    readPaths: [
      ['/linear/teams/<teamId>.json', 'Team records.'],
      ['/linear/issues/<issueId>.json', 'Issue records.'],
      ['/linear/users/<userId>.json', 'User records.'],
      ['/linear/comments/<commentId>.json', 'Comment records.'],
    ],
    endpoints: [
      endpoint('/linear/issues/new.json', 'Create Linear issue', 'Creates a Linear issue.', ['teamId', 'title'], {
        teamId: str('Linear team UUID. List `/linear/teams/` to find available teams.', 'uuid'),
        title: str('Issue title.', undefined, { minLength: 1 }),
        description: str('Markdown issue body.'),
        priority: en([0, 1, 2, 3, 4], '0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low.'),
        assigneeId: str('Linear assignee user UUID.', 'uuid'),
        stateId: str('Linear workflow state UUID.', 'uuid'),
        projectId: str('Linear project UUID.', 'uuid'),
        cycleId: str('Linear cycle UUID.', 'uuid'),
        labelIds: arr(str('Linear label UUID.', 'uuid'), 'Linear label UUIDs.'),
        dueDate: str('Due date in YYYY-MM-DD form.', 'date'),
        estimate: num('Linear estimate value.'),
        parentId: str('Parent issue UUID.', 'uuid'),
      }, { teamId: '00000000-0000-0000-0000-000000000000', title: 'Replace example title', description: 'Optional markdown body.', priority: 0 }),
      endpoint('/linear/issues/{issueId}/comments/new.json', 'Create Linear issue comment', 'Creates a comment on a Linear issue.', ['body'], {
        body: str('Comment body.', undefined, { minLength: 1 }),
        parentId: str('Parent comment UUID for threaded replies.', 'uuid'),
        doNotSubscribeToIssue: bool('Whether to avoid subscribing the commenter to the issue.'),
      }, { body: 'Replace example comment body.' }),
    ],
  },
  {
    slug: 'notion',
    title: 'Notion adapter',
    overview:
      'The Notion adapter exposes databases, pages, page markdown, blocks, and comments under `/notion`, with writeback routes for creating database pages, updating page properties/content, archiving pages, and creating page comments.',
    readPaths: [
      ['/notion/databases/<databaseId>/metadata.json', 'Database metadata.'],
      ['/notion/databases/<databaseId>/pages/<pageId>.json', 'Database page records.'],
      ['/notion/pages/<pageId>.json', 'Standalone page records.'],
      ['/notion/pages/<pageId>/content.md', 'Rendered page markdown.'],
    ],
    endpoints: [
      endpoint('/notion/databases/{databaseId}/pages/new.json', 'Create Notion database page', 'Creates a page inside a Notion database.', ['properties'], {
        properties: obj('Serialized Notion property map. Each property value should match the adapter property serializer shape.'),
        children: arr(obj('Notion block object.'), 'Optional child blocks for the new page.'),
        markdown: str('Optional markdown body. When present the adapter uses the Notion markdown API version.'),
      }, { properties: { Name: { type: 'title', value: 'Replace example page title' } } }),
      endpoint('/notion/databases/{databaseId}/pages/{pageId}.json', 'Update Notion database page properties', 'Updates properties, archive state, icon, or cover for a page inside a Notion database.', [], notionPagePatchProps(), {
        properties: { Status: { type: 'select', value: 'In progress' } },
      }, notionPagePatchRequirement()),
      endpoint('/notion/databases/{databaseId}/pages/{pageId}/properties.json', 'Update Notion database page properties file', 'Updates properties, archive state, icon, or cover through a database page properties sidecar.', [], notionPagePatchProps(), {
        properties: { Status: { type: 'select', value: 'In progress' } },
      }, notionPagePatchRequirement()),
      endpoint('/notion/databases/{databaseId}/pages/{pageId}/content.md', 'Replace Notion database page markdown', 'Replaces the rendered markdown body for a page inside a Notion database.', [], {
        markdown: str('Plain markdown body written to content.md.'),
      }, { markdown: '# Replace page content' }),
      endpoint('/notion/databases/{databaseId}/pages/{pageId}/comments.json', 'Create Notion database page comment', 'Creates a Notion comment on a page inside a Notion database from comments.json.', [], notionCommentProps(), {
        text: 'Replace example comment body.',
      }, notionCommentRequirement()),
      endpoint('/notion/pages/{pageId}.json', 'Update Notion standalone page properties', 'Updates properties, archive state, icon, or cover for a standalone page.', [], notionPagePatchProps(), {
        properties: { Status: { type: 'select', value: 'In progress' } },
      }, notionPagePatchRequirement()),
      endpoint('/notion/pages/{pageId}/properties.json', 'Update Notion standalone page properties file', 'Updates properties, archive state, icon, or cover through a standalone page properties sidecar.', [], notionPagePatchProps(), {
        properties: { Status: { type: 'select', value: 'In progress' } },
      }, notionPagePatchRequirement()),
      endpoint('/notion/pages/{pageId}/content.md', 'Replace Notion standalone page markdown', 'Replaces the rendered markdown body for a standalone page.', [], {
        markdown: str('Plain markdown body written to content.md.'),
      }, { markdown: '# Replace page content' }),
      endpoint('/notion/pages/{pageId}/comments.json', 'Create Notion standalone page comment', 'Creates a Notion comment on a standalone page from comments.json.', [], notionCommentProps(), {
        text: 'Replace example comment body.',
      }, notionCommentRequirement()),
    ],
  },
  {
    slug: 'pipedrive',
    title: 'Pipedrive adapter',
    overview:
      'The Pipedrive adapter exposes deals, persons, organizations, and activities under `/pipedrive`, with writeback routes for creating and updating those objects.',
    readPaths: [
      ['/pipedrive/deals/<dealId>.json', 'Deal records.'],
      ['/pipedrive/persons/<personId>.json', 'Person records.'],
      ['/pipedrive/organizations/<organizationId>.json', 'Organization records.'],
      ['/pipedrive/activities/<activityId>.json', 'Activity records.'],
    ],
    endpoints: [
      endpoint('/pipedrive/deals/new.json', 'Create Pipedrive deal', 'Creates a Pipedrive deal.', ['title'], pipedriveDealProps(), { title: 'Replace example deal title' }),
      endpoint('/pipedrive/persons/new.json', 'Create Pipedrive person', 'Creates a Pipedrive person.', ['name'], pipedrivePersonProps(), { name: 'Replace example person name' }),
      endpoint('/pipedrive/organizations/new.json', 'Create Pipedrive organization', 'Creates a Pipedrive organization.', ['name'], pipedriveOrganizationProps(), { name: 'Replace example organization name' }),
      endpoint('/pipedrive/activities/new.json', 'Create Pipedrive activity', 'Creates a Pipedrive activity.', ['subject'], pipedriveActivityProps(), { subject: 'Replace example activity subject' }),
    ],
  },
  {
    slug: 'salesforce',
    title: 'Salesforce adapter',
    overview:
      'The Salesforce adapter exposes Account, Contact, Opportunity, Lead, and Case sObjects under `/salesforce`, with writeback routes for creating and updating those records.',
    readPaths: [
      ['/salesforce/accounts/<accountId>.json', 'Account records.'],
      ['/salesforce/contacts/<contactId>.json', 'Contact records.'],
      ['/salesforce/opportunities/<opportunityId>.json', 'Opportunity records.'],
      ['/salesforce/leads/<leadId>.json', 'Lead records.'],
      ['/salesforce/cases/<caseId>.json', 'Case records.'],
    ],
    endpoints: [
      salesforceEndpoint('/salesforce/accounts/new.json', 'Create Salesforce account', 'Creates a Salesforce Account.', { Name: 'Replace example account name' }, ['Name'], salesforceAccountProps()),
      salesforceEndpoint('/salesforce/contacts/new.json', 'Create Salesforce contact', 'Creates a Salesforce Contact.', { LastName: 'Replace example contact last name', Email: 'contact@example.com' }, ['LastName'], salesforceContactProps()),
      salesforceEndpoint('/salesforce/opportunities/new.json', 'Create Salesforce opportunity', 'Creates a Salesforce Opportunity.', { Name: 'Replace example opportunity name', StageName: 'Prospecting', CloseDate: '2026-06-01' }, ['Name', 'StageName', 'CloseDate'], salesforceOpportunityProps()),
      salesforceEndpoint('/salesforce/leads/new.json', 'Create Salesforce lead', 'Creates a Salesforce Lead.', { LastName: 'Replace example lead last name', Company: 'Replace example company name' }, ['LastName', 'Company'], salesforceLeadProps()),
      salesforceEndpoint('/salesforce/cases/new.json', 'Create Salesforce case', 'Creates a Salesforce Case.', { Subject: 'Replace example case subject' }, ['Subject'], salesforceCaseProps()),
    ],
  },
  {
    slug: 'slack',
    title: 'Slack adapter',
    overview:
      'The Slack adapter exposes channels, users, messages, threads, replies, files, and reactions under `/slack`, with writeback routes for posting channel messages, direct messages, replies, and reactions.',
    readPaths: [
      ['/slack/channels/<channelId>.json', 'Channel records.'],
      ['/slack/channels/<channelId>/messages/<messageTs>/meta.json', 'Message records.'],
      ['/slack/channels/<channelId>/messages/<messageTs>/replies/<replyTs>.json', 'Thread reply records.'],
      ['/slack/users/<userId>.json', 'User records.'],
    ],
    endpoints: [
      endpoint('/slack/channels/{channelId}/messages/new.json', 'Post Slack message', 'Posts a top-level Slack message.', [], slackMessageProps(), { text: 'Replace example message text.' }, slackContentRequirement()),
      endpoint('/slack/users/{userId}/messages/new.json', 'Post Slack direct message', 'Opens or reuses a direct message conversation and posts a Slack message.', [], slackDirectMessageProps(), { text: 'Replace example direct message text.' }, slackContentRequirement()),
      endpoint('/slack/channels/{channelId}/messages/{messageTs}/replies/new.json', 'Post Slack thread reply', 'Posts a reply in a Slack thread.', [], { ...slackMessageProps(), reply_broadcast: bool('Whether Slack should also broadcast the reply to the channel.') }, { text: 'Replace example reply text.' }, slackContentRequirement()),
      endpoint('/slack/channels/{channelId}/messages/{messageTs}/reactions/new.json', 'Add Slack reaction', 'Adds an emoji reaction to a Slack message.', [], {
        name: str('Emoji name without surrounding colons. `reaction` is also accepted.'),
        reaction: str('Alias for `name`.'),
        channel: str('Optional Slack channel id override.'),
      }, { name: 'eyes' }, { anyOf: [{ required: ['name'] }, { required: ['reaction'] }] }),
    ],
  },
  {
    slug: 'teams',
    title: 'Teams adapter',
    overview:
      'The Teams adapter exposes teams, channels, messages, replies, chats, tabs, members, and reactions under `/teams`, with writeback routes for creating channel messages, replies, and chat messages.',
    readPaths: [
      ['/teams/<teamId>/metadata.json', 'Team records.'],
      ['/teams/<teamId>/channels/<channelId>/metadata.json', 'Channel records.'],
      ['/teams/<teamId>/channels/<channelId>/messages/<messageId>.json', 'Channel message records.'],
      ['/teams/chats/<chatId>/messages/<messageId>.json', 'Chat message records.'],
    ],
    endpoints: [
      endpoint('/teams/{teamId}/channels/{channelId}/messages/new.json', 'Create Teams channel message', 'Posts a new Teams channel message.', [], teamsMessageProps(), { body: { content: 'Replace example message HTML.' } }, teamsContentRequirement()),
      endpoint('/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/new.json', 'Create Teams thread reply', 'Posts a reply to a Teams channel message.', [], teamsMessageProps(), { body: { content: 'Replace example reply HTML.' } }, teamsContentRequirement()),
      endpoint('/teams/chats/{chatId}/messages/new.json', 'Create Teams chat message', 'Posts a new Teams chat message.', [], teamsMessageProps(), { body: { content: 'Replace example chat message HTML.' } }, teamsContentRequirement()),
    ],
  },
  {
    slug: 'zendesk',
    title: 'Zendesk adapter',
    overview:
      'The Zendesk adapter exposes tickets, users, and organizations under `/zendesk`, with writeback routes for creating tickets, ticket comments, and users.',
    readPaths: [
      ['/zendesk/tickets/<ticketId>.json', 'Ticket records.'],
      ['/zendesk/tickets/<ticketId>/comments/<commentId>.json', 'Ticket comment records.'],
      ['/zendesk/users/<userId>.json', 'User records.'],
      ['/zendesk/organizations/<organizationId>.json', 'Organization records.'],
    ],
    endpoints: [
      endpoint('/zendesk/tickets/{ticketId}/comments/new.json', 'Create Zendesk ticket comment', 'Adds a comment to a Zendesk ticket.', ['body'], {
        body: str('Plain-text comment body.'),
        html_body: str('HTML comment body.'),
        public: bool('Whether the comment is public. Defaults to true.'),
      }, { body: 'Replace example comment body.', public: true }),
      endpoint('/zendesk/tickets/new.json', 'Create Zendesk ticket', 'Creates a Zendesk ticket.', ['subject'], zendeskTicketProps(), { subject: 'Replace example ticket subject' }),
      endpoint('/zendesk/users/new.json', 'Create Zendesk user', 'Creates a Zendesk user.', ['name'], zendeskUserProps(), { name: 'Ada Lovelace', email: 'ada@example.com' }),
    ],
  },
  {
    slug: 'azure-blob',
    title: 'Azure Blob Storage adapter',
    overview: 'The Azure Blob Storage adapter exposes blobs and Event Grid subscriptions with file-native writeback discovery.',
    readPaths: [['/azure/<account>/<container>/<blob>', 'Azure blob content.']],
    endpoints: [
      endpoint('/azure-blob/blobs/new.json', 'Create Azure blob', 'Uploads a blob.', ['account', 'container', 'name'], { account: str('Azure account.'), container: str('Container.'), name: str('Blob name.'), contentBase64: str('Base64 content.') }, { account: 'acct', container: 'invoices', name: '2026/may.csv', contentBase64: 'aWQsdG90YWwKMSw0Mg==' }),
      endpoint('/azure-blob/event-subscriptions/new.json', 'Create Azure Event Grid subscription', 'Creates a storage Event Grid subscription.', ['endpointUrl'], { endpointUrl: str('Webhook endpoint URL.'), includedEventTypes: arr(str('Azure event type.'), 'Included event types.') }, { endpointUrl: 'https://example.com/hooks/azure' }),
    ],
  },
  {
    slug: 'box',
    title: 'Box adapter',
    overview: 'The Box adapter exposes files and webhook subscriptions with file-native writeback discovery.',
    readPaths: [['/box/<account>/<path>', 'Box file content.']],
    endpoints: [
      endpoint('/box/files/new.json', 'Create Box file', 'Uploads a Box file.', ['name'], { name: str('File name.'), parent: obj('Parent folder.'), contentBase64: str('Base64 content.') }, { name: 'Contract.pdf', parent: { id: '0' } }),
      endpoint('/box/webhooks/new.json', 'Create Box webhook', 'Creates a Box webhook.', ['target', 'triggers', 'address'], { target: obj('Webhook target.'), triggers: arr(str('Trigger.'), 'Triggers.'), address: str('Webhook address.') }, { target: { id: '12345', type: 'folder' }, triggers: ['FILE.UPLOADED'], address: 'https://example.com/hooks/box' }),
    ],
  },
  {
    slug: 'dropbox',
    title: 'Dropbox adapter',
    overview: 'The Dropbox adapter exposes file entries and list_folder cursors with file-native writeback discovery.',
    readPaths: [['/dropbox/<account>/<path>', 'Dropbox file content.']],
    endpoints: [
      endpoint('/dropbox/files/new.json', 'Create Dropbox file', 'Uploads a Dropbox file.', ['path_display'], { path_display: str('Dropbox display path.'), contentBase64: str('Base64 content.'), mode: str('Upload mode.') }, { path_display: '/Team/Notes.md' }),
      endpoint('/dropbox/cursors/new.json', 'Create Dropbox cursor', 'Stores a list_folder cursor.', ['cursor'], { cursor: str('Dropbox cursor.'), accountId: str('Account id.') }, { cursor: 'cursor-2' }),
    ],
  },
  {
    slug: 'gcs',
    title: 'Google Cloud Storage adapter',
    overview: 'The GCS adapter exposes objects and Pub/Sub notification configs with file-native writeback discovery.',
    readPaths: [['/gcs/<bucket>/<object>', 'GCS object content.']],
    endpoints: [
      endpoint('/gcs/objects/new.json', 'Create GCS object', 'Uploads a GCS object.', ['bucket', 'name'], { bucket: str('Bucket.'), name: str('Object name.'), contentBase64: str('Base64 content.') }, { bucket: 'rf-archive', name: 'reports/q2.json' }),
      endpoint('/gcs/notifications/new.json', 'Create GCS notification', 'Creates a bucket notification.', ['bucket', 'topic'], { bucket: str('Bucket.'), topic: str('Pub/Sub topic.') }, { bucket: 'rf-archive', topic: 'projects/example/topics/gcs' }),
    ],
  },
  {
    slug: 'gmail',
    title: 'Gmail adapter',
    overview: 'The Gmail adapter exposes threads, drafts, and watches with file-native writeback discovery.',
    readPaths: [['/gmail/<account>/threads/<threadId>.json', 'Gmail thread records.']],
    endpoints: [
      endpoint('/gmail/threads/new.json', 'Create Gmail thread marker', 'Creates or updates a Gmail thread record.', ['id'], { id: str('Thread id.'), labelIds: arr(str('Label id.'), 'Labels.') }, { id: 'thread-1' }),
      endpoint('/gmail/drafts/new.json', 'Create Gmail draft', 'Creates a Gmail draft.', ['message'], { message: obj('Draft message.') }, { message: { raw: 'RnJvbTogbWVAZXhhbXBsZS5jb20K' } }),
      endpoint('/gmail/watches/new.json', 'Create Gmail watch', 'Starts a Gmail watch.', ['topicName'], { topicName: str('Pub/Sub topic.'), labelIds: arr(str('Label id.'), 'Labels.') }, { topicName: 'projects/example/topics/gmail' }),
    ],
  },
  {
    slug: 'google-drive',
    title: 'Google Drive adapter',
    overview: 'The Google Drive adapter exposes files and watch channels with file-native writeback discovery.',
    readPaths: [['/google-drive/<account>/<path>', 'Drive file content.']],
    endpoints: [
      endpoint('/google-drive/files/new.json', 'Create Google Drive file', 'Creates a Drive file.', ['name'], { name: str('File name.'), mimeType: str('MIME type.'), parents: arr(str('Parent id.'), 'Parents.') }, { name: 'Roadmap.pdf', mimeType: 'application/pdf' }),
      endpoint('/google-drive/channels/new.json', 'Create Google Drive watch channel', 'Creates a Drive watch channel.', ['resourceId', 'address'], { resourceId: str('Resource id.'), address: str('Webhook address.'), type: str('Channel type.') }, { resourceId: 'file_123', address: 'https://example.com/hooks/drive' }),
    ],
  },
  {
    slug: 'google-calendar',
    title: 'Google Calendar adapter',
    overview:
      'The Google Calendar adapter exposes calendar and event records under `/google-calendar`, with writeback routes for creating, patching, and deleting events.',
    readPaths: [
      ['/google-calendar/calendars/<calendarId>.json', 'Calendar metadata.'],
      ['/google-calendar/calendars/<calendarId>/events/<eventId>.json', 'Calendar event records.'],
    ],
    endpoints: [
      endpoint('/google-calendar/calendars/{calendarId}/events/new.json', 'Create Google Calendar event', 'Creates a calendar event in the calendar named by the path.', ['start', 'end'], googleCalendarEventProps(), {
        summary: 'Team planning',
        start: { dateTime: '2026-05-12T09:00:00Z' },
        end: { dateTime: '2026-05-12T09:30:00Z' },
      }, googleCalendarContentRequirement()),
    ],
  },
  {
    slug: 'onedrive',
    title: 'OneDrive adapter',
    overview: 'The OneDrive adapter exposes drive items and Graph subscriptions with file-native writeback discovery.',
    readPaths: [['/onedrive/<account>/<path>', 'OneDrive file content.']],
    endpoints: [
      endpoint('/onedrive/items/new.json', 'Create OneDrive item', 'Creates or updates a drive item.', ['name'], { name: str('Item name.'), contentBase64: str('Base64 content.') }, { name: 'Budget.xlsx' }),
      endpoint('/onedrive/subscriptions/new.json', 'Create OneDrive subscription', 'Creates a Graph subscription.', ['resource', 'changeType', 'notificationUrl', 'expirationDateTime'], { resource: str('Graph resource.'), changeType: str('Graph change type.'), notificationUrl: str('Notification URL.'), expirationDateTime: str('Expiration.') }, { resource: 'me/drive/root', changeType: 'updated', notificationUrl: 'https://example.com/hooks/graph', expirationDateTime: '2026-05-10T00:00:00.000Z' }),
    ],
  },
  {
    slug: 'postgres',
    title: 'Postgres adapter',
    overview: 'The Postgres adapter exposes rows and LISTEN channels with file-native writeback discovery.',
    readPaths: [['/postgres/<db>/<schema>/<table>/<pk>.json', 'Postgres row records.']],
    endpoints: [
      endpoint('/postgres/rows/new.json', 'Create Postgres row', 'Creates a row.', ['_op', 'primaryKey', 'row'], { _op: str('Operation.'), primaryKey: str('Primary key column.'), row: obj('Row values.') }, { _op: 'insert', primaryKey: 'id', row: { title: 'Bridge plan' } }),
      endpoint('/postgres/listeners/new.json', 'Create Postgres listener', 'Registers a LISTEN channel.', ['channel'], { channel: str('LISTEN channel.'), table: str('Table.') }, { channel: 'relayfile_storage_events' }),
    ],
  },
  {
    slug: 'redis',
    title: 'Redis adapter',
    overview: 'The Redis adapter exposes keys and keyspace listeners with file-native writeback discovery.',
    readPaths: [['/redis/<db>/<key>.json', 'Redis key records.']],
    endpoints: [
      endpoint('/redis/keys/new.json', 'Create Redis key', 'Writes a Redis key.', ['key', 'type', 'value'], { key: str('Redis key.'), type: str('Value type.'), value: obj('Value.') }, { key: 'session:43', type: 'hash', value: { userId: 'u2' } }),
      endpoint('/redis/listeners/new.json', 'Create Redis listener', 'Registers a keyspace listener.', ['db'], { db: int('Redis database.'), pattern: str('Pattern.') }, { db: 0, pattern: '__keyspace@0__:*' }),
    ],
  },
  {
    slug: 's3',
    title: 'Amazon S3 adapter',
    overview: 'The S3 adapter exposes objects and SQS notification queues with file-native writeback discovery.',
    readPaths: [['/s3/<bucket>/<key>', 'S3 object content.']],
    endpoints: [
      endpoint('/s3/objects/new.json', 'Create S3 object', 'Uploads an S3 object.', ['Bucket', 'Key'], { Bucket: str('Bucket.'), Key: str('Object key.'), BodyBase64: str('Base64 body.') }, { Bucket: 'rf-bucket', Key: 'logs/app.log' }),
      endpoint('/s3/queues/new.json', 'Create S3 queue notification', 'Creates an S3 queue notification config.', ['QueueUrl'], { QueueUrl: str('SQS Queue URL.'), Bucket: str('Bucket.') }, { QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/queue', Bucket: 'rf-bucket' }),
    ],
  },
  {
    slug: 'sharepoint',
    title: 'SharePoint adapter',
    overview: 'The SharePoint adapter exposes drive items and Graph subscriptions with file-native writeback discovery.',
    readPaths: [['/sharepoint/<siteId>/<driveId>/<path>', 'SharePoint file content.']],
    endpoints: [
      endpoint('/sharepoint/items/new.json', 'Create SharePoint item', 'Creates or updates a drive item.', ['name'], { name: str('Item name.'), contentBase64: str('Base64 content.') }, { name: 'Plan.docx' }),
      endpoint('/sharepoint/subscriptions/new.json', 'Create SharePoint subscription', 'Creates a Graph subscription.', ['resource', 'changeType', 'notificationUrl', 'expirationDateTime'], { resource: str('Graph resource.'), changeType: str('Graph change type.'), notificationUrl: str('Notification URL.'), expirationDateTime: str('Expiration.') }, { resource: 'sites/site-a/drives/drive-a/root', changeType: 'updated', notificationUrl: 'https://example.com/hooks/graph', expirationDateTime: '2026-05-10T00:00:00.000Z' }),
    ],
  },
];

function endpoint(path, title, description, required, properties, example, schemaExtra = {}) {
  return {
    path,
    schemaPath: path.replace(/new\.json$/, 'new.schema.json'),
    examplePath: path.replace(/new\.json$/, 'new.example.json'),
    description,
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title,
      type: 'object',
      required,
      ...schemaExtra,
      properties,
      additionalProperties: false,
    },
    example,
  };
}

function contractEndpoint(path, operationId, example, options = {}) {
  return {
    path,
    example,
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
    contract: {
      operationId,
      ...(options.schemaOverrides ? { schemaOverrides: options.schemaOverrides } : {}),
    },
  };
}

function str(description, format, extra = {}) {
  return compact({ type: 'string', format, description, ...extra });
}

function bool(description) {
  return { type: 'boolean', description };
}

function int(description, extra = {}) {
  return { type: 'integer', description, ...extra };
}

function num(description) {
  return { type: 'number', description };
}

function arr(items, description) {
  return { type: 'array', description, items };
}

function obj(description, properties, extra = {}) {
  return properties
    ? { type: 'object', description, properties, additionalProperties: true, ...extra }
    : { type: 'object', description, additionalProperties: true, ...extra };
}

function en(values, description) {
  return { enum: values, description };
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function hubspotEndpoint(path, title, description, example) {
  return {
    ...endpoint(path, title, description, [], {
      properties: obj('HubSpot properties object. If omitted, top-level writable keys are treated as properties.'),
    }, { properties: example }),
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title,
      type: 'object',
      required: [],
      description: 'Provide either a `properties` object or top-level HubSpot writable property keys.',
      oneOf: [
        {
          required: ['properties'],
          properties: {
            properties: {
              type: 'object',
              minProperties: 1,
            },
          },
          additionalProperties: false,
        },
        {
          minProperties: 1,
          not: { required: ['properties'] },
        },
      ],
      properties: {
        properties: obj('HubSpot CRM property names and values. Read HubSpot object property metadata to discover object-specific keys.', undefined, { minProperties: 1 }),
      },
      additionalProperties: {
        description: 'Writable HubSpot CRM property value.',
      },
    },
  };
}

function salesforceEndpoint(path, title, description, example, required = [], properties = {}) {
  return {
    ...endpoint(path, title, description, required, properties, example),
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title,
      type: 'object',
      required,
      description: 'Salesforce sObject fields for the target object type.',
      propertyNames: {
        pattern: '^[A-Za-z][A-Za-z0-9_]*(__(c|r))?$',
      },
      properties,
      additionalProperties: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'integer' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'object', additionalProperties: true },
          { type: 'array', items: true },
        ],
        description: 'Writable Salesforce sObject field value. Use Salesforce object metadata to discover required fields for the object type.',
      },
    },
  };
}

function clickupTaskProps() {
  return {
    name: str('Task name.'),
    description: str('Plain-text task description.'),
    markdown_description: str('Markdown task description.'),
    assignees: arr(str('ClickUp user id.'), 'Assignee user ids.'),
    tags: arr(str('Tag name.'), 'Task tags.'),
    status: str('Initial task status.'),
    priority: int('ClickUp priority id.'),
    due_date: int('Due date as Unix epoch milliseconds.'),
    due_date_time: bool('Whether due_date includes a time.'),
    start_date: int('Start date as Unix epoch milliseconds.'),
    start_date_time: bool('Whether start_date includes a time.'),
    time_estimate: int('Time estimate in milliseconds.'),
    points: num('Sprint points.'),
    notify_all: bool('Whether to notify all watchers.'),
    parent: str('Parent task id.'),
    links_to: str('Task id this task links to.'),
    check_required_custom_fields: bool('Whether ClickUp should validate required custom fields.'),
    custom_fields: arr(obj('Custom field assignment.'), 'Custom field assignments.'),
  };
}

function clickupListProps() {
  return {
    name: str('List name.'),
    content: str('List description.'),
    due_date: int('Due date as Unix epoch milliseconds.'),
    priority: int('ClickUp priority id.'),
    assignee: str('Assignee user id.'),
    status: str('List status.'),
  };
}

function confluencePageProps(options = {}) {
  return {
    title: str('Page title.', undefined, { minLength: 1 }),
    ...(options.includeSpaceId === false ? {} : { spaceId: str('Confluence space id.') }),
    status: en(['current', 'draft'], 'Page status. Defaults to current.'),
    parentId: str('Optional parent page id.'),
    body: {
      description: 'Confluence page body as a storage-format string or a body object with `value`/`representation` or `storage.value`.',
      oneOf: [
        { type: 'string', minLength: 1 },
        {
          type: 'object',
          additionalProperties: true,
          required: ['value', 'representation'],
          properties: {
            value: { type: 'string', minLength: 1 },
            representation: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          additionalProperties: true,
          required: ['storage'],
          properties: {
            storage: {
              type: 'object',
              additionalProperties: true,
              required: ['value'],
              properties: {
                value: { type: 'string', minLength: 1 },
                representation: { type: 'string' },
              },
            },
          },
        },
      ],
    },
    version: obj('Optional synced version object. Updates increment `version.number` when present.', {
      number: int('Current Confluence version number.', { minimum: 1 }),
      message: str('Version message.'),
      minorEdit: bool('Whether the update is a minor edit.'),
    }),
  };
}

function gitlabDiscussionProps() {
  return {
    body: str('Markdown note body.', undefined, { minLength: 1, pattern: '.*\\S.*' }),
    position: obj('Optional GitLab position object for diff discussions.'),
    created_at: str('Optional timestamp for imports when supported by GitLab.', 'date-time'),
  };
}

function gitlabIssueNoteProps() {
  return {
    body: str('Markdown note body.', undefined, { minLength: 1, pattern: '.*\\S.*' }),
    created_at: str('Optional timestamp for imports when supported by GitLab.', 'date-time'),
  };
}

function slackMessageProps() {
  return {
    text: str('Message text. Required unless blocks or attachments are supplied.'),
    blocks: arr(obj('Slack Block Kit block.'), 'Slack Block Kit blocks.'),
    attachments: arr(obj('Slack message attachment.'), 'Slack message attachments.'),
    channel: str('Optional Slack channel id override.'),
    thread_ts: str('Optional Slack thread timestamp override.'),
    username: str('Bot display name override for tokens that support it.'),
    icon_emoji: str('Bot emoji icon override.'),
    icon_url: str('Bot icon URL override.', 'uri'),
    unfurl_links: bool('Whether Slack should unfurl links.'),
    unfurl_media: bool('Whether Slack should unfurl media.'),
    mrkdwn: bool('Whether Slack should parse mrkdwn in text.'),
  };
}

function slackDirectMessageProps() {
  const { channel, thread_ts, ...properties } = slackMessageProps();
  return properties;
}

function slackContentRequirement() {
  return {
    anyOf: [
      { required: ['text'] },
      { required: ['blocks'] },
      { required: ['attachments'] },
    ],
  };
}

function googleCalendarEventProps() {
  const eventTime = obj('Google Calendar event time.', {
    date: str('All-day event date in YYYY-MM-DD form.', 'date'),
    dateTime: str('Timed event timestamp in RFC 3339 form.', 'date-time'),
    timeZone: str('IANA time zone name.'),
  });
  const attendee = obj('Event attendee.', {
    email: str('Attendee email address.', 'email'),
    displayName: str('Attendee display name.'),
    optional: bool('Whether attendance is optional.'),
    resource: bool('Whether the attendee is a room or resource.'),
    responseStatus: en(['needsAction', 'declined', 'tentative', 'accepted'], 'Attendee response status.'),
  });

  return {
    summary: str('Event title.'),
    description: str('Event description. Google Calendar accepts HTML.'),
    location: str('Free-form event location.'),
    start: eventTime,
    end: eventTime,
    attendees: arr(attendee, 'Event attendees.'),
    status: en(['confirmed', 'tentative', 'cancelled'], 'Event status.'),
    recurrence: arr(str('RRULE, EXRULE, RDATE, or EXDATE recurrence line.'), 'Recurrence lines.'),
    reminders: obj('Reminder settings.', {
      useDefault: bool('Whether to use calendar default reminders.'),
      overrides: arr(obj('Reminder override.', {
        method: en(['email', 'popup'], 'Reminder delivery method.'),
        minutes: int('Minutes before the event start.', { minimum: 0 }),
      }), 'Reminder overrides.'),
    }),
    conferenceData: obj('Conference data such as a Google Meet create request.'),
    transparency: en(['opaque', 'transparent'], 'Whether the event blocks calendar availability.'),
    visibility: en(['default', 'public', 'private', 'confidential'], 'Event visibility.'),
    colorId: str('Google Calendar color id.'),
  };
}

function googleCalendarContentRequirement() {
  return {
    anyOf: [
      { required: ['summary'] },
      { required: ['description'] },
      { required: ['location'] },
      { required: ['attendees'] },
      { required: ['recurrence'] },
      { required: ['conferenceData'] },
    ],
  };
}

function teamsMessageProps() {
  return {
    body: obj('Teams message body.', {
      contentType: en(['html', 'text'], 'Message content type. The adapter sends html by default.'),
      content: str('Message body content.'),
    }, { required: ['content'] }),
    text: str('Plain text or HTML message content. Used when `body.content` is omitted.'),
    content: str('Plain text or HTML message content. Used when `body.content` and `text` are omitted.'),
  };
}

function teamsContentRequirement() {
  return {
    anyOf: [
      {
        required: ['body'],
        properties: {
          body: {
            type: 'object',
            required: ['content'],
          },
        },
      },
      { required: ['text'] },
      { required: ['content'] },
    ],
  };
}

function pipedriveDealProps() {
  return {
    title: str('Deal title.'),
    value: num('Deal value.'),
    currency: str('Currency code.'),
    status: en(['open', 'won', 'lost', 'deleted'], 'Deal status.'),
    stage_id: int('Pipeline stage id.'),
    pipeline_id: int('Pipeline id.'),
    person_id: int('Linked person id.'),
    org_id: int('Linked organization id.'),
    user_id: int('Owner user id.'),
    expected_close_date: str('Expected close date in YYYY-MM-DD form.', 'date'),
    probability: int('Deal probability percentage.'),
    label: str('Deal label.'),
  };
}

function pipedrivePersonProps() {
  return {
    name: str('Person name.'),
    first_name: str('First name.'),
    last_name: str('Last name.'),
    email: arr(obj('Email entry.'), 'Email entries accepted by Pipedrive.'),
    phone: arr(obj('Phone entry.'), 'Phone entries accepted by Pipedrive.'),
    owner_id: int('Owner user id.'),
    org_id: int('Linked organization id.'),
    visible_to: str('Visibility setting.'),
  };
}

function pipedriveOrganizationProps() {
  return {
    name: str('Organization name.'),
    owner_id: int('Owner user id.'),
    address: str('Organization address.'),
    visible_to: str('Visibility setting.'),
  };
}

function pipedriveActivityProps() {
  return {
    subject: str('Activity subject.'),
    type: str('Activity type.'),
    done: bool('Whether the activity is complete.'),
    due_date: str('Due date in YYYY-MM-DD form.', 'date'),
    due_time: str('Due time in HH:MM form.', undefined, { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    duration: str('Duration in HH:MM form.', undefined, { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    note: str('Activity note.'),
    deal_id: int('Linked deal id.'),
    person_id: int('Linked person id.'),
    org_id: int('Linked organization id.'),
    user_id: int('Owner user id.'),
  };
}

function salesforceAccountProps() {
  return {
    Name: str('Account name.'),
    Website: str('Account website URL.', 'uri'),
    Phone: str('Account phone number.'),
    Industry: str('Account industry.'),
    Type: str('Account type.'),
    BillingStreet: str('Billing street address.'),
    BillingCity: str('Billing city.'),
    BillingState: str('Billing state or province.'),
    BillingPostalCode: str('Billing postal code.'),
    BillingCountry: str('Billing country.'),
    OwnerId: str('Owner user id.'),
  };
}

function notionPagePatchProps() {
  return {
    properties: obj('Serialized Notion property map. Each property value should match the adapter property serializer shape.'),
    archived: bool('Whether to archive or restore the page.'),
    icon: obj('Notion page icon object.'),
    cover: obj('Notion page cover object.'),
  };
}

function notionPagePatchRequirement() {
  return {
    anyOf: [
      { required: ['properties'] },
      { required: ['archived'] },
      { required: ['icon'] },
      { required: ['cover'] },
    ],
  };
}

function notionCommentProps() {
  return {
    text: str('Plain text comment body. A raw string body is also accepted by the resolver.', undefined, { minLength: 1, pattern: '.*\\S.*' }),
    discussionId: str('Optional Notion discussion id to append to.'),
    richText: { ...arr(obj('Notion rich_text object.'), 'Optional rich_text array.'), minItems: 1 },
  };
}

function notionCommentRequirement() {
  return {
    anyOf: [
      { required: ['text'] },
      { required: ['richText'] },
    ],
  };
}

function salesforceContactProps() {
  return {
    LastName: str('Contact last name.'),
    FirstName: str('Contact first name.'),
    Email: str('Contact email address.', 'email'),
    Phone: str('Contact phone number.'),
    MobilePhone: str('Contact mobile phone number.'),
    Title: str('Contact job title.'),
    AccountId: str('Linked Account id.'),
    OwnerId: str('Owner user id.'),
  };
}

function salesforceOpportunityProps() {
  return {
    Name: str('Opportunity name.'),
    StageName: str('Opportunity stage name.'),
    CloseDate: str('Expected close date in YYYY-MM-DD form.', 'date'),
    Amount: num('Opportunity amount.'),
    AccountId: str('Linked Account id.'),
    Type: str('Opportunity type.'),
    LeadSource: str('Lead source.'),
    OwnerId: str('Owner user id.'),
    Description: str('Opportunity description.'),
  };
}

function salesforceLeadProps() {
  return {
    LastName: str('Lead last name.'),
    Company: str('Lead company name.'),
    FirstName: str('Lead first name.'),
    Email: str('Lead email address.', 'email'),
    Phone: str('Lead phone number.'),
    Status: str('Lead status.'),
    LeadSource: str('Lead source.'),
    OwnerId: str('Owner user id.'),
    Title: str('Lead job title.'),
  };
}

function salesforceCaseProps() {
  return {
    Subject: str('Case subject.'),
    Description: str('Case description.'),
    Status: str('Case status.'),
    Priority: str('Case priority.'),
    Origin: str('Case origin.'),
    Type: str('Case type.'),
    Reason: str('Case reason.'),
    AccountId: str('Linked Account id.'),
    ContactId: str('Linked Contact id.'),
    SuppliedEmail: str('Supplied contact email address.', 'email'),
    OwnerId: str('Owner user id.'),
  };
}

function zendeskTicketProps() {
  return {
    subject: str('Ticket subject.'),
    description: str('Ticket description.'),
    comment: obj('Initial ticket comment.'),
    requester_id: int('Requester user id.'),
    assignee_id: int('Assignee user id.'),
    group_id: int('Group id.'),
    organization_id: int('Organization id.'),
    priority: en(['urgent', 'high', 'normal', 'low'], 'Ticket priority.'),
    status: en(['new', 'open', 'pending', 'hold', 'solved', 'closed'], 'Ticket status.'),
    type: en(['problem', 'incident', 'question', 'task'], 'Ticket type.'),
    tags: arr(str('Tag.'), 'Ticket tags.'),
    custom_fields: arr(obj('Zendesk custom field.'), 'Zendesk custom fields.'),
  };
}

function zendeskUserProps() {
  return {
    name: str('User name.'),
    email: str('User email address.', 'email'),
    role: str('Zendesk user role.'),
    phone: str('User phone number.'),
    organization_id: int('Organization id.'),
    external_id: str('External id.'),
    tags: arr(str('Tag.'), 'User tags.'),
    user_fields: obj('Zendesk user field values.'),
    verified: bool('Whether the email is verified.'),
  };
}
