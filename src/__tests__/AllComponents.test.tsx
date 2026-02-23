import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---- Mock API module ----
vi.mock('../services/api', () => ({
  checkApiKeyStatus:    vi.fn().mockResolvedValue({ configured: true, source: 'db', model: 'gemini-2.5-flash' }),
  saveApiKey:           vi.fn().mockResolvedValue({ success: true }),
  validateApiKey:       vi.fn().mockResolvedValue({ valid: true }),
  fetchAvailableModels: vi.fn().mockResolvedValue({ models: [], currentModel: 'gemini-2.5-flash' }),
  saveModelPreference:  vi.fn().mockResolvedValue({ success: true, model: 'gemini-2.5-flash' }),
  getModelPreference:   vi.fn().mockResolvedValue({ model: 'gemini-2.5-flash' }),
  listMeetings: vi.fn().mockResolvedValue({ meetings: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 1 } }),
  getMeeting: vi.fn().mockResolvedValue({
    id: 'test-1', title: 'Test Meeting', created_at: '2025-01-01', status: 'completed',
    inputs: [], result: { raw_markdown: '# 1. Executive Summary\nTest\n# 2. Detailed Summary\nDetails\n# 3. Cleaned Transcript\n[00:00] Host: Hi\n# 4. Metadata\n```json\n{"title":"Test"}\n```', executive_summary: 'Test', metadata_json: '{}' }, participants: [],
  }),
  createMeeting:        vi.fn().mockResolvedValue({ id: 'new-1', status: 'pending' }),
  analyzeWithServer:    vi.fn().mockResolvedValue('# Analysis\nFull report'),
  saveMeetingResult:    vi.fn().mockResolvedValue({ success: true }),
  updateMeetingStatus:  vi.fn().mockResolvedValue({ success: true }),
  deleteMeeting:        vi.fn().mockResolvedValue({ success: true }),
  getDashboardStats:    vi.fn().mockResolvedValue({ total: 5, completed: 3, processing: 1, totalDuration: 120, recentMeetings: [] }),
  healthCheck:          vi.fn().mockResolvedValue({ status: 'ok' }),
}));

// ---- Mock geminiService ----
vi.mock('../services/geminiService', () => ({
  analyzeMeeting: vi.fn().mockResolvedValue('# 1. Executive Summary\nMock result\n# 2. Detailed Summary\nDetails\n# 3. Cleaned Transcript\n[00:00] Host: Hi\n# 4. Metadata\n```json\n{"title":"Mock"}\n```'),
  setApiKeyCache: vi.fn(),
  clearApiKeyCache: vi.fn(),
}));

// ---- Import components after mocks ----
import { ApiKeySetup } from '../components/ApiKeySetup';
import { Dashboard } from '../components/Dashboard';
import { Layout } from '../components/Layout';
import { ProcessingState } from '../components/ProcessingState';
import { ResultView } from '../components/ResultView';
import { MeetingHistory } from '../components/MeetingHistory';
import { MeetingDetailView } from '../components/MeetingDetailView';
import App from '../App';
import * as api from '../services/api';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

// ============================
// ApiKeySetup
// ============================
describe('ApiKeySetup', () => {
  it('should render the setup form', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    expect(screen.getByText('MeetingSense AI')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your API key...')).toBeInTheDocument();
    expect(screen.getByText('Continue →')).toBeInTheDocument();
  });

  it('should have submit button disabled when input is empty', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    expect(screen.getByText('Continue →')).toBeDisabled();
  });

  it('should enable submit when API key is entered', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Enter your API key...'), { target: { value: 'test-key' } });
    expect(screen.getByText('Continue →')).not.toBeDisabled();
  });

  it('should call validate and save on submit', async () => {
    const onConfigured = vi.fn();
    render(<ApiKeySetup onConfigured={onConfigured} />);
    fireEvent.change(screen.getByPlaceholderText('Enter your API key...'), { target: { value: 'valid-key' } });
    fireEvent.click(screen.getByText('Continue →'));

    await waitFor(() => {
      expect(api.validateApiKey).toHaveBeenCalledWith('valid-key');
    });
    await waitFor(() => {
      expect(api.saveApiKey).toHaveBeenCalledWith('valid-key');
    });
  });

  it('should show error when validation fails', async () => {
    vi.mocked(api.validateApiKey).mockResolvedValueOnce({ valid: false, error: 'Invalid key' });
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Enter your API key...'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByText('Continue →'));
    await waitFor(() => {
      expect(screen.getByText('Invalid key')).toBeInTheDocument();
    });
  });

  it('should show link to Google AI Studio', () => {
    render(<ApiKeySetup onConfigured={vi.fn()} />);
    expect(screen.getByText('Google AI Studio')).toBeInTheDocument();
    expect(screen.getByText('Google AI Studio').closest('a')).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  });
});

// ============================
// Dashboard
// ============================
describe('Dashboard', () => {
  it('should render dashboard with stats', async () => {
    render(<Dashboard onNewMeeting={vi.fn()} onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('should show New Meeting button', async () => {
    render(<Dashboard onNewMeeting={vi.fn()} onViewMeeting={vi.fn()} />);
    expect(screen.getByText('New Meeting')).toBeInTheDocument();
  });

  it('should call onNewMeeting when New Meeting clicked', async () => {
    const onNew = vi.fn();
    render(<Dashboard onNewMeeting={onNew} onViewMeeting={vi.fn()} />);
    fireEvent.click(screen.getByText('New Meeting'));
    expect(onNew).toHaveBeenCalled();
  });

  it('should show stats cards', async () => {
    render(<Dashboard onNewMeeting={vi.fn()} onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Total Meetings')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText('Total Minutes')).toBeInTheDocument();
    });
  });

  it('should show empty state when no meetings', async () => {
    render(<Dashboard onNewMeeting={vi.fn()} onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('No meetings yet')).toBeInTheDocument();
    });
  });

  it('should show recent meetings when available', async () => {
    vi.mocked(api.listMeetings).mockResolvedValueOnce({
      meetings: [{ id: 'm1', title: 'Sprint Review', created_at: '2025-06-01T10:00:00Z', status: 'completed' }],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
    const onView = vi.fn();
    render(<Dashboard onNewMeeting={vi.fn()} onViewMeeting={onView} />);
    await waitFor(() => {
      expect(screen.getByText('Sprint Review')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Sprint Review'));
    expect(onView).toHaveBeenCalledWith('m1');
  });
});

// ============================
// Layout
// ============================
describe('Layout', () => {
  it('should render sidebar with navigation items', () => {
    render(<Layout currentView="dashboard" onNavigate={vi.fn()} sidebarOpen={true} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()}>
      <div>Content</div>
    </Layout>);
    expect(screen.getByText('MeetingSense AI')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('New Meeting')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('API Settings')).toBeInTheDocument();
  });

  it('should call onNavigate when nav items clicked', () => {
    const onNav = vi.fn();
    render(<Layout currentView="dashboard" onNavigate={onNav} sidebarOpen={true} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()}>
      <div>Content</div>
    </Layout>);
    fireEvent.click(screen.getByText('History'));
    expect(onNav).toHaveBeenCalledWith('history');
  });

  it('should call onOpenSettings when settings clicked', () => {
    const onSettings = vi.fn();
    render(<Layout currentView="dashboard" onNavigate={vi.fn()} sidebarOpen={true} onToggleSidebar={vi.fn()} onOpenSettings={onSettings}>
      <div>Content</div>
    </Layout>);
    fireEvent.click(screen.getByText('API Settings'));
    expect(onSettings).toHaveBeenCalled();
  });

  it('should call onToggleSidebar when logo clicked', () => {
    const onToggle = vi.fn();
    render(<Layout currentView="dashboard" onNavigate={vi.fn()} sidebarOpen={true} onToggleSidebar={onToggle} onOpenSettings={vi.fn()}>
      <div>Content</div>
    </Layout>);
    fireEvent.click(screen.getByText('MeetingSense AI'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('should highlight active nav item', () => {
    render(<Layout currentView="history" onNavigate={vi.fn()} sidebarOpen={true} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()}>
      <div>Content</div>
    </Layout>);
    const historyBtn = screen.getByText('History').closest('button');
    expect(historyBtn?.className).toContain('brand');
  });

  it('should render children in main area', () => {
    render(<Layout currentView="dashboard" onNavigate={vi.fn()} sidebarOpen={true} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()}>
      <div data-testid="child">Hello</div>
    </Layout>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('should hide labels when sidebar collapsed', () => {
    render(<Layout currentView="dashboard" onNavigate={vi.fn()} sidebarOpen={false} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()}>
      <div>Content</div>
    </Layout>);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('History')).not.toBeInTheDocument();
  });
});

// ============================
// ProcessingState
// ============================
describe('ProcessingState', () => {
  it('should render processing steps', () => {
    render(<ProcessingState />);
    expect(screen.getByText('Analyzing Your Meeting')).toBeInTheDocument();
    expect(screen.getByText('Uploading files...')).toBeInTheDocument();
  });

  it('should advance through steps over time', async () => {
    render(<ProcessingState />);
    expect(screen.getByText('Uploading files...')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(3000); });
    // The second step should now be active or the first should have a checkmark
    expect(screen.getByText('Processing audio/text...')).toBeInTheDocument();
  });
});

// ============================
// ResultView
// ============================
describe('ResultView', () => {
  const mockContent = '# 1. Executive Summary\nGreat meeting about AI.\n# 2. Detailed Summary\n## 2.1 Topics\n- AI Strategy\n# 3. Cleaned Transcript\n[00:00] Harish: Welcome\n# 4. Metadata\n```json\n{"title":"AI Meeting","participants":["Harish"]}\n```';

  it('should render with tab navigation', () => {
    render(<ResultView content={mockContent} onReset={vi.fn()} />);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Full Report')).toBeInTheDocument();
    expect(screen.getByText('Transcript')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
  });

  it('should show Copy, Export, and New Analysis buttons', () => {
    render(<ResultView content={mockContent} onReset={vi.fn()} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Export .md')).toBeInTheDocument();
    expect(screen.getByText('New Analysis')).toBeInTheDocument();
  });

  it('should call onReset when New Analysis clicked', () => {
    const onReset = vi.fn();
    render(<ResultView content={mockContent} onReset={onReset} />);
    fireEvent.click(screen.getByText('New Analysis'));
    expect(onReset).toHaveBeenCalled();
  });

  it('should switch tabs on click', () => {
    render(<ResultView content={mockContent} onReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Transcript'));
    // The transcript tab should now be active (rendered with brand styling)
    const transcriptBtn = screen.getByText('Transcript').closest('button');
    expect(transcriptBtn?.className).toContain('brand');
  });

  it('should copy content to clipboard on Copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ResultView content={mockContent} onReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith(mockContent);
    await waitFor(() => { expect(screen.getByText('Copied!')).toBeInTheDocument(); });
  });
});

// ============================
// MeetingHistory
// ============================
describe('MeetingHistory', () => {
  it('should render search and filter', async () => {
    render(<MeetingHistory onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search meetings...')).toBeInTheDocument();
    });
    // Check filter dropdown exists
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('should show empty state when no meetings', async () => {
    render(<MeetingHistory onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('No meetings found')).toBeInTheDocument();
    });
  });

  it('should render meetings and handle click', async () => {
    vi.mocked(api.listMeetings).mockResolvedValueOnce({
      meetings: [
        { id: 'h1', title: 'Design Review', created_at: '2025-06-15T14:00:00Z', status: 'completed', executive_summary: 'Discussed designs' },
      ],
      pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
    });
    const onView = vi.fn();
    render(<MeetingHistory onViewMeeting={onView} />);
    await waitFor(() => {
      expect(screen.getByText('Design Review')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Design Review'));
    expect(onView).toHaveBeenCalledWith('h1');
  });

  it('should change status filter', async () => {
    render(<MeetingHistory onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
    // listMeetings should be called again with status filter
    await waitFor(() => {
      expect(api.listMeetings).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });
  });

  it('should search by text', async () => {
    render(<MeetingHistory onViewMeeting={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search meetings...')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('Search meetings...'), { target: { value: 'sprint' } });
    await waitFor(() => {
      expect(api.listMeetings).toHaveBeenCalledWith(expect.objectContaining({ search: 'sprint' }));
    });
  });
});

// ============================
// MeetingDetailView
// ============================
describe('MeetingDetailView', () => {
  it('should render meeting detail with back button', async () => {
    render(<MeetingDetailView meetingId="test-1" onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Test Meeting')).toBeInTheDocument();
    });
  });

  it('should call onBack when back button clicked', async () => {
    const onBack = vi.fn();
    render(<MeetingDetailView meetingId="test-1" onBack={onBack} />);
    await waitFor(() => {
      expect(screen.getByText('Test Meeting')).toBeInTheDocument();
    });
    // The back button is the first button
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // Back arrow
    expect(onBack).toHaveBeenCalled();
  });

  it('should show Export Markdown button for completed meetings', async () => {
    render(<MeetingDetailView meetingId="test-1" onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Export Markdown')).toBeInTheDocument();
    });
  });

  it('should show loading state initially', () => {
    render(<MeetingDetailView meetingId="test-1" onBack={vi.fn()} />);
    // Should show spinner initially (before data loads)
    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });
});

// ============================
// App Integration
// ============================
describe('App — Full Integration', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(api.checkApiKeyStatus).mockResolvedValue({ configured: true, source: 'db' });
    vi.mocked(api.getDashboardStats).mockResolvedValue({ total: 5, completed: 3, processing: 1, totalDuration: 120 });
    vi.mocked(api.listMeetings).mockResolvedValue({ meetings: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 1 } });
  });

  // "Dashboard" text appears in sidebar nav AND page heading, so use unique text
  const waitForDashboardPage = () => waitFor(() => {
    expect(screen.getByText('Your meeting intelligence hub')).toBeInTheDocument();
  });

  it('should show loading spinner initially', () => {
    render(<App />);
    expect(screen.getByText('Initializing MeetingSense AI...')).toBeInTheDocument();
  });

  it('should show dashboard when API key is configured', async () => {
    render(<App />);
    await waitForDashboardPage();
  });

  it('should show API key setup when not configured', async () => {
    vi.mocked(api.checkApiKeyStatus).mockResolvedValue({ configured: false, source: '' });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Configure your Gemini API key to get started')).toBeInTheDocument();
    });
  });

  it('should navigate to new meeting when New Meeting clicked', async () => {
    render(<App />);
    await waitForDashboardPage();
    const navButtons = screen.getAllByText('New Meeting');
    fireEvent.click(navButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Start Recording')).toBeInTheDocument();
    });
  });

  it('should navigate to history', async () => {
    render(<App />);
    await waitForDashboardPage();
    fireEvent.click(screen.getByText('History'));
    await waitFor(() => {
      expect(screen.getByText('Meeting History')).toBeInTheDocument();
    });
  });

  it('should navigate back to dashboard from history', async () => {
    render(<App />);
    await waitForDashboardPage();
    fireEvent.click(screen.getByText('History'));
    await waitFor(() => { expect(screen.getByText('Meeting History')).toBeInTheDocument(); });
    // Click Dashboard in sidebar nav
    fireEvent.click(screen.getAllByText('Dashboard')[0]);
    await waitForDashboardPage();
  });
});
