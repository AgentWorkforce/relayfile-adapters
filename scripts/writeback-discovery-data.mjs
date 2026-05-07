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
    slug: 'github',
    title: 'GitHub adapter',
    overview:
      'The GitHub adapter exposes repository pull requests, issues, reviews, comments, commits, files, and checks under `/github`, with writeback support for submitting pull request reviews.',
    readPaths: [
      ['/github/repos/<owner>/<repo>/pulls/<pullNumber>/metadata.json', 'Pull request metadata.'],
      ['/github/repos/<owner>/<repo>/pulls/<pullNumber>/files/<path>', 'Pull request file records.'],
      ['/github/repos/<owner>/<repo>/issues/<issueNumber>/metadata.json', 'Issue metadata.'],
      ['/github/repos/<owner>/<repo>/commits/<sha>/metadata.json', 'Commit metadata.'],
    ],
    endpoints: [
      endpoint('/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/new.json', 'Submit GitHub pull request review', 'Submits a pull request review with optional inline comments.', ['event', 'body', 'comments'], {
        event: en(['APPROVE', 'COMMENT', 'REQUEST_CHANGES'], 'Review event to submit.'),
        body: str('Top-level review body.'),
        comments: arr(obj('Inline review comment.', {
          path: str('Repository-relative file path.'),
          line: int('Line number on the selected side.', { minimum: 1 }),
          side: en(['LEFT', 'RIGHT'], 'Diff side for the comment. Defaults to RIGHT.'),
          body: str('Inline comment body.'),
          suggestion: str('Optional suggested replacement text appended to the comment body.'),
        }), 'Inline review comments. Use an empty array for a body-only review.'),
        metadata: obj('Optional submission metadata.', {
          commitSha: str('Commit SHA to anchor the review to.'),
          connectionId: str('Relayfile connection id override.'),
          providerConfigKey: str('GitHub provider config key override.'),
        }),
      }, { event: 'COMMENT', body: 'Replace example review body.', comments: [] }),
    ],
  },
  {
    slug: 'gitlab',
    title: 'GitLab adapter',
    overview:
      'The GitLab adapter exposes projects, merge requests, discussions, issues, commits, pipelines, and jobs under `/gitlab`, with writeback routes for merge request discussions and issue notes.',
    readPaths: [
      ['/gitlab/projects/<namespace>/<project>/merge_requests/<iid>/metadata.json', 'Merge request metadata.'],
      ['/gitlab/projects/<namespace>/<project>/merge_requests/<iid>/discussions/<discussionId>.json', 'Merge request discussions.'],
      ['/gitlab/projects/<namespace>/<project>/issues/<iid>/metadata.json', 'Issue metadata.'],
      ['/gitlab/projects/<namespace>/<project>/pipelines/<pipelineId>/jobs/<jobId>.json', 'Pipeline job records.'],
    ],
    endpoints: [
      endpoint('/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}/discussions/new.json', 'Create GitLab merge request discussion', 'Creates a discussion on a merge request.', ['body'], gitlabNoteProps(), { body: 'Replace example discussion body.' }),
      endpoint('/gitlab/projects/{projectPath}/issues/{issueIid}/comments/new.json', 'Create GitLab issue note', 'Creates a note on an issue.', ['body'], gitlabNoteProps(), { body: 'Replace example note body.' }),
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
      'The Jira adapter exposes issues, comments, projects, and sprints under `/jira`, with writeback routes for creating issues, projects, and issue comments.',
    readPaths: [
      ['/jira/issues/<issueIdOrKey>.json', 'Issue records.'],
      ['/jira/issues/<issueIdOrKey>/comments/<commentId>.json', 'Issue comment records.'],
      ['/jira/projects/<projectIdOrKey>.json', 'Project records.'],
      ['/jira/sprints/<sprintId>.json', 'Sprint records.'],
    ],
    endpoints: [
      endpoint('/jira/issues/{issueIdOrKey}/comments/new.json', 'Create Jira issue comment', 'Adds a comment to a Jira issue.', ['body'], {
        body: obj('Jira rich-text document body. A plain string body is also accepted by the resolver.'),
      }, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replace example comment text.' }] }] } }),
      endpoint('/jira/issues/new.json', 'Create Jira issue', 'Creates a Jira issue.', ['fields'], {
        fields: obj('Jira issue fields.', {
          project: obj('Project object. Usually includes `key` or `id`.'),
          summary: str('Issue summary.'),
          issuetype: obj('Issue type object. Usually includes `name` or `id`.'),
          description: obj('Jira rich-text description document.'),
          priority: obj('Priority object. Usually includes `name` or `id`.'),
          labels: arr(str('Issue label.'), 'Issue labels.'),
        }),
      }, { fields: { project: { key: 'PROJ' }, summary: 'Replace example summary', issuetype: { name: 'Task' } } }),
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
      'The Notion adapter exposes databases, pages, page markdown, blocks, and comments under `/notion`, with writeback routes for creating database pages and updating page content.',
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
      endpoint('/pipedrive/persons/new.json', 'Create Pipedrive person', 'Creates a Pipedrive person.', ['name'], pipedrivePersonProps(), { name: 'Ada Lovelace' }),
      endpoint('/pipedrive/organizations/new.json', 'Create Pipedrive organization', 'Creates a Pipedrive organization.', ['name'], pipedriveOrganizationProps(), { name: 'Example Inc' }),
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
      salesforceEndpoint('/salesforce/accounts/new.json', 'Create Salesforce account', 'Creates a Salesforce Account.', { Name: 'Example Inc' }),
      salesforceEndpoint('/salesforce/contacts/new.json', 'Create Salesforce contact', 'Creates a Salesforce Contact.', { LastName: 'Lovelace', Email: 'ada@example.com' }),
      salesforceEndpoint('/salesforce/opportunities/new.json', 'Create Salesforce opportunity', 'Creates a Salesforce Opportunity.', { Name: 'Example opportunity', StageName: 'Prospecting', CloseDate: '2026-06-01' }),
      salesforceEndpoint('/salesforce/leads/new.json', 'Create Salesforce lead', 'Creates a Salesforce Lead.', { LastName: 'Lovelace', Company: 'Example Inc' }),
      salesforceEndpoint('/salesforce/cases/new.json', 'Create Salesforce case', 'Creates a Salesforce Case.', { Subject: 'Example case' }),
    ],
  },
  {
    slug: 'slack',
    title: 'Slack adapter',
    overview:
      'The Slack adapter exposes channels, users, messages, threads, replies, files, and reactions under `/slack`, with writeback routes for posting messages, replies, and reactions.',
    readPaths: [
      ['/slack/channels/<channelId>.json', 'Channel records.'],
      ['/slack/channels/<channelId>/messages/<messageTs>.json', 'Message records.'],
      ['/slack/channels/<channelId>/messages/<messageTs>/replies/<replyTs>.json', 'Thread reply records.'],
      ['/slack/users/<userId>.json', 'User records.'],
    ],
    endpoints: [
      endpoint('/slack/channels/{channelId}/messages/new.json', 'Post Slack message', 'Posts a top-level Slack message.', [], slackMessageProps(), { text: 'Replace example message text.' }),
      endpoint('/slack/channels/{channelId}/messages/{messageTs}/replies/new.json', 'Post Slack thread reply', 'Posts a reply in a Slack thread.', [], { ...slackMessageProps(), reply_broadcast: bool('Whether Slack should also broadcast the reply to the channel.') }, { text: 'Replace example reply text.' }),
      endpoint('/slack/channels/{channelId}/messages/{messageTs}/reactions/new.json', 'Add Slack reaction', 'Adds an emoji reaction to a Slack message.', ['name'], {
        name: str('Emoji name without surrounding colons. `reaction` is also accepted.'),
        reaction: str('Alias for `name`.'),
        channel: str('Optional Slack channel id override.'),
      }, { name: 'eyes' }),
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
      endpoint('/teams/{teamId}/channels/{channelId}/messages/new.json', 'Create Teams channel message', 'Posts a new Teams channel message.', [], teamsMessageProps(), { body: { content: 'Replace example message HTML.' } }),
      endpoint('/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/new.json', 'Create Teams thread reply', 'Posts a reply to a Teams channel message.', [], teamsMessageProps(), { body: { content: 'Replace example reply HTML.' } }),
      endpoint('/teams/chats/{chatId}/messages/new.json', 'Create Teams chat message', 'Posts a new Teams chat message.', [], teamsMessageProps(), { body: { content: 'Replace example chat message HTML.' } }),
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
];

function endpoint(path, title, description, required, properties, example) {
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
      properties,
      additionalProperties: false,
    },
    example,
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

function obj(description, properties) {
  return properties
    ? { type: 'object', description, properties, additionalProperties: true }
    : { type: 'object', description, additionalProperties: true };
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
      properties: {
        properties: obj('HubSpot CRM property names and values. Read HubSpot object property metadata to discover object-specific keys.'),
      },
      additionalProperties: {
        description: 'Writable HubSpot CRM property value.',
      },
    },
  };
}

function salesforceEndpoint(path, title, description, example) {
  return {
    ...endpoint(path, title, description, [], {}, example),
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title,
      type: 'object',
      required: [],
      description: 'Salesforce sObject fields for the target object type.',
      properties: {},
      additionalProperties: {
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

function gitlabNoteProps() {
  return {
    body: str('Markdown note body.'),
    position: obj('Optional GitLab position object for diff discussions.'),
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

function teamsMessageProps() {
  return {
    body: obj('Teams message body.', {
      contentType: en(['html', 'text'], 'Message content type. The adapter sends html by default.'),
      content: str('Message body content.'),
    }),
    text: str('Plain text or HTML message content. Used when `body.content` is omitted.'),
    content: str('Plain text or HTML message content. Used when `body.content` and `text` are omitted.'),
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
    due_time: str('Due time in HH:MM form.'),
    duration: str('Duration in HH:MM form.'),
    note: str('Activity note.'),
    deal_id: int('Linked deal id.'),
    person_id: int('Linked person id.'),
    org_id: int('Linked organization id.'),
    user_id: int('Owner user id.'),
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
