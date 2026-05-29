#!/usr/bin/env python3
"""
Generate CMB Equipment Inventory Management (EIM) System Build Plan PDF
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, ListFlowable, ListItem
)
from reportlab.platypus.flowables import Flowable
from reportlab.pdfgen import canvas
from datetime import datetime
import os

# ── Colors ──
CMB_DARK = HexColor('#1a1a2e')
CMB_PRIMARY = HexColor('#16213e')
CMB_ACCENT = HexColor('#0f3460')
CMB_HIGHLIGHT = HexColor('#e94560')
CMB_LIGHT_BG = HexColor('#f8f9fa')
CMB_BORDER = HexColor('#dee2e6')
CMB_TEXT = HexColor('#212529')
CMB_MUTED = HexColor('#6c757d')
CMB_SUCCESS = HexColor('#28a745')
CMB_WARNING = HexColor('#ffc107')
CMB_INFO = HexColor('#17a2b8')
CMB_WHITE = HexColor('#ffffff')

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), 'CMB_EIM_System_Build_Plan.pdf')

# ── Custom Flowables ──

class SectionHeader(Flowable):
    def __init__(self, text, number=None, width=None):
        Flowable.__init__(self)
        self.text = text
        self.number = number
        self._width = width or 7.5 * inch
        self.height = 0.55 * inch

    def wrap(self, availWidth, availHeight):
        return (self._width, self.height)

    def draw(self):
        c = self.canv
        c.setFillColor(CMB_PRIMARY)
        c.roundRect(0, 0, self._width, self.height, 4, fill=1, stroke=0)
        c.setFillColor(CMB_HIGHLIGHT)
        c.roundRect(0, 0, 6, self.height, 2, fill=1, stroke=0)
        c.setFont('Helvetica-Bold', 14)
        c.setFillColor(white)
        label = f"{self.number}. {self.text}" if self.number else self.text
        c.drawString(18, 0.18 * inch, label)


class SubSectionHeader(Flowable):
    def __init__(self, text, width=None):
        Flowable.__init__(self)
        self.text = text
        self._width = width or 7.5 * inch
        self.height = 0.38 * inch

    def wrap(self, availWidth, availHeight):
        return (self._width, self.height)

    def draw(self):
        c = self.canv
        c.setFillColor(CMB_LIGHT_BG)
        c.roundRect(0, 0, self._width, self.height, 3, fill=1, stroke=0)
        c.setStrokeColor(CMB_ACCENT)
        c.setLineWidth(2)
        c.line(0, 0, 0, self.height)
        c.setFont('Helvetica-Bold', 11)
        c.setFillColor(CMB_ACCENT)
        c.drawString(10, 0.12 * inch, self.text)


class ModuleCard(Flowable):
    def __init__(self, title, icon_text, description, features, color, width=None):
        Flowable.__init__(self)
        self.title = title
        self.icon_text = icon_text
        self.description = description
        self.features = features
        self.color = HexColor(color) if isinstance(color, str) else color
        self._width = width or 3.5 * inch
        self.height = 2.8 * inch

    def wrap(self, availWidth, availHeight):
        return (self._width, self.height)

    def draw(self):
        c = self.canv
        c.setStrokeColor(self.color)
        c.setLineWidth(1.5)
        c.setFillColor(white)
        c.roundRect(0, 0, self._width, self.height, 6, fill=1, stroke=1)
        c.setFillColor(self.color)
        c.roundRect(0, self.height - 4, self._width, 4, 2, fill=1, stroke=0)
        c.setFont('Helvetica-Bold', 10)
        c.setFillColor(self.color)
        y = self.height - 22
        c.drawString(12, y, f"{self.icon_text}  {self.title}")
        c.setFont('Helvetica', 7.5)
        c.setFillColor(CMB_MUTED)
        y -= 14
        c.drawString(12, y, self.description[:70])
        c.setFont('Helvetica', 7)
        c.setFillColor(CMB_TEXT)
        y -= 16
        for feat in self.features[:8]:
            c.setFillColor(self.color)
            c.circle(18, y + 3, 2.5, fill=1, stroke=0)
            c.setFillColor(CMB_TEXT)
            c.drawString(25, y, feat[:55])
            y -= 12


# ── Page Templates ──

def cover_page(canvas_obj, doc):
    c = canvas_obj
    w, h = letter
    c.setFillColor(CMB_DARK)
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(CMB_PRIMARY)
    c.rect(0, h * 0.35, w, h * 0.65, fill=1, stroke=0)
    c.setFillColor(CMB_HIGHLIGHT)
    c.rect(0, h * 0.35, w, 4, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont('Helvetica-Bold', 32)
    c.drawCentredString(w / 2, h * 0.75, 'CMB FILM SERVICES')
    c.setFont('Helvetica', 14)
    c.setFillColor(HexColor('#adb5bd'))
    c.drawCentredString(w / 2, h * 0.70, 'Equipment Department')
    c.setStrokeColor(CMB_HIGHLIGHT)
    c.setLineWidth(2)
    c.line(w * 0.25, h * 0.66, w * 0.75, h * 0.66)
    c.setFont('Helvetica-Bold', 22)
    c.setFillColor(white)
    c.drawCentredString(w / 2, h * 0.58, 'Equipment Inventory Management')
    c.drawCentredString(w / 2, h * 0.53, 'System Build Plan')
    c.setFont('Helvetica', 11)
    c.setFillColor(HexColor('#ced4da'))
    c.drawCentredString(w / 2, h * 0.46, 'Comprehensive Technical Architecture & Implementation Roadmap')
    c.setFont('Helvetica', 10)
    c.setFillColor(HexColor('#adb5bd'))
    c.drawCentredString(w / 2, h * 0.25, f"Document Version: 1.0")
    c.drawCentredString(w / 2, h * 0.22, f"Date: {datetime.now().strftime('%B %d, %Y')}")
    c.drawCentredString(w / 2, h * 0.19, "Classification: Internal - CMB Equipment Department")
    c.setFont('Helvetica', 8)
    c.setFillColor(CMB_MUTED)
    c.drawCentredString(w / 2, h * 0.08, "CMB Film Services, Inc. | Equipment Inventory Management System")
    c.drawCentredString(w / 2, h * 0.06, "This document is proprietary and confidential")


def header_footer(canvas_obj, doc):
    c = canvas_obj
    w, h = letter
    c.setFillColor(CMB_PRIMARY)
    c.rect(0, h - 28, w, 28, fill=1, stroke=0)
    c.setFont('Helvetica-Bold', 7)
    c.setFillColor(white)
    c.drawString(0.5 * inch, h - 19, 'CMB EIM SYSTEM BUILD PLAN')
    c.setFont('Helvetica', 7)
    c.drawRightString(w - 0.5 * inch, h - 19, f'v1.0 | {datetime.now().strftime("%B %Y")}')
    c.setFillColor(CMB_HIGHLIGHT)
    c.rect(0, h - 30, w, 2, fill=1, stroke=0)
    c.setFillColor(CMB_BORDER)
    c.rect(0, 32, w, 0.5, fill=1, stroke=0)
    c.setFont('Helvetica', 7)
    c.setFillColor(CMB_MUTED)
    c.drawString(0.5 * inch, 18, 'CMB Film Services, Inc. | Confidential')
    c.drawRightString(w - 0.5 * inch, 18, f'Page {doc.page}')


# ── Build Document ──

def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.65 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        title='CMB EIM System Build Plan',
        author='CMB Film Services, Inc.',
        subject='Equipment Inventory Management System - Technical Build Plan',
    )

    styles = getSampleStyleSheet()
    usable = 7.5 * inch

    body = ParagraphStyle('Body', parent=styles['Normal'], fontName='Helvetica',
                          fontSize=9, leading=14, textColor=CMB_TEXT, alignment=TA_JUSTIFY,
                          spaceAfter=6)
    body_bold = ParagraphStyle('BodyBold', parent=body, fontName='Helvetica-Bold')
    bullet_style = ParagraphStyle('Bullet', parent=body, leftIndent=18, bulletIndent=6,
                                   spaceBefore=2, spaceAfter=2)
    sub_bullet = ParagraphStyle('SubBullet', parent=bullet_style, leftIndent=36, bulletIndent=24,
                                 fontSize=8.5, leading=12)
    caption = ParagraphStyle('Caption', parent=body, fontSize=7.5, textColor=CMB_MUTED,
                              alignment=TA_CENTER, spaceAfter=8, spaceBefore=4)
    toc_style = ParagraphStyle('TOC', parent=body, fontSize=10, leading=18,
                                leftIndent=12, textColor=CMB_PRIMARY)

    def tbl_style_base():
        return [
            ('BACKGROUND', (0, 0), (-1, 0), CMB_PRIMARY),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('LEADING', (0, 0), (-1, -1), 12),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, CMB_BORDER),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, CMB_LIGHT_BG]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]

    story = []

    # ══════════════════════════════════════════════════════════════
    # COVER PAGE
    # ══════════════════════════════════════════════════════════════
    story.append(Spacer(1, 0.01 * inch))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # TABLE OF CONTENTS
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Table of Contents', width=usable))
    story.append(Spacer(1, 0.15 * inch))

    toc_items = [
        ('1', 'Executive Summary'),
        ('2', 'System Overview & Architecture'),
        ('3', 'Core Modules'),
        ('  3.1', 'Equipment Acquisition Management'),
        ('  3.2', 'Rental Equipment Inventory Management'),
        ('  3.3', 'Repair & Maintenance Management'),
        ('  3.4', 'Parts Management'),
        ('4', 'Database Schema Design'),
        ('5', 'Supabase Sync Strategy'),
        ('6', 'Application Structure & UI Layout'),
        ('7', 'Tech Stack'),
        ('8', 'Data Flow & Integration Logic'),
        ('9', 'User Roles & Permissions'),
        ('10', 'Development Phases & Timeline'),
        ('11', 'Risk Assessment & Mitigation'),
        ('12', 'Success Criteria & Acceptance'),
    ]
    for num, title in toc_items:
        indent = 24 if num.startswith('  ') else 0
        weight = 'Helvetica-Bold' if not num.startswith('  ') else 'Helvetica'
        s = ParagraphStyle('toc_item', parent=body, fontName=weight, fontSize=9.5,
                           leading=17, leftIndent=indent, textColor=CMB_PRIMARY)
        story.append(Paragraph(f"{num.strip()}  {'  ' if not num.startswith('  ') else ''}{title}", s))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 1. EXECUTIVE SUMMARY
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Executive Summary', '1', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The <b>CMB Equipment Inventory Management (EIM) System</b> is a dedicated desktop application '
        'designed to serve as the central operations hub for CMB Film Services\' equipment department. '
        'It will operate as a companion application alongside the existing <b>CMB Rental Request System</b> '
        '(1 Take), sharing the same Supabase cloud backend for real-time data synchronization.',
        body))
    story.append(Spacer(1, 0.08 * inch))
    story.append(Paragraph(
        'The EIM system manages the complete lifecycle of equipment assets: from initial acquisition and '
        'inventory registration, through rental availability tracking, repair and maintenance workflows, '
        'to spare parts and expendables management. Every status change in the EIM system directly affects '
        'equipment availability in the main rental app, making it a critical operational dependency for '
        'the equipment department.',
        body))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('Key Objectives', usable))
    story.append(Spacer(1, 0.06 * inch))
    objectives = [
        '<b>Centralized Asset Management</b> -- Single source of truth for all equipment assets, their status, location, and condition.',
        '<b>Seamless Supabase Integration</b> -- Bidirectional real-time sync with the Rental Request System via shared Supabase tables.',
        '<b>Equipment Lifecycle Tracking</b> -- From acquisition to retirement, track every state transition with audit trails.',
        '<b>Maintenance Workflow Automation</b> -- Structured repair/maintenance pipeline with scheduling, parts tracking, and cost analysis.',
        '<b>Parts & Expendables Control</b> -- Inventory management for spare parts, consumables, and expendable items with reorder alerts.',
        '<b>Availability Impact Visibility</b> -- Real-time visibility into how inventory changes affect rental availability across the fleet.',
    ]
    for obj in objectives:
        story.append(Paragraph(obj, bullet_style, bulletText='•'))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 2. SYSTEM OVERVIEW & ARCHITECTURE
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('System Overview & Architecture', '2', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The EIM system follows the same proven Electron-based architecture established by the CMB Rental '
        'Request System (1 Take). This ensures consistency in development patterns, deployment mechanisms, '
        'and sync behavior across both applications.',
        body))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('High-Level Architecture Diagram', usable))
    story.append(Spacer(1, 0.08 * inch))

    arch_data = [
        ['Layer', 'Component', 'Description'],
        ['Cloud', 'Supabase (PostgreSQL)', 'Shared cloud database -- single source of truth for equipment catalog,\nstatus, and operational data across all CMB applications'],
        ['Cloud', 'Supabase Realtime', 'WebSocket channels for instant cross-app data propagation;\nboth EIM and Rental apps subscribe to the same tables'],
        ['App Shell', 'Electron 33 (Main Process)', 'Node.js runtime hosting SQLite, Supabase client, PDF generation,\nand all business logic -- renderer never touches data directly'],
        ['App Shell', 'Electron (Preload)', 'Secure bridge via contextBridge exposing typed IPC channels;\nenforces process isolation between UI and data layers'],
        ['Frontend', 'React 18 + TypeScript', 'Component-driven UI with Zustand state management;\ncommunicates exclusively through IPC invoke calls'],
        ['Local DB', 'better-sqlite3 (SQLite)', 'Offline-first local database with WAL journaling;\nsyncs bidirectionally with Supabase on connectivity'],
        ['Sync', 'SyncManager + OfflineQueue', 'Manages online/offline transitions, queues mutations when disconnected,\nreplays on reconnect with conflict resolution'],
    ]

    t = Table(arch_data, colWidths=[0.8 * inch, 1.8 * inch, 4.9 * inch])
    t.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5),
        ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t)
    story.append(Paragraph('Table 2.1 -- Architecture layers and their responsibilities', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('System Interaction Model', usable))
    story.append(Spacer(1, 0.06 * inch))

    interaction_data = [
        ['Flow', 'Direction', 'Mechanism', 'Impact'],
        ['Equipment Added (EIM)', 'EIM --> Supabase --> Rental App', 'Catalog sync push + Realtime', 'New equipment appears in rental catalog'],
        ['Equipment Unavailable (EIM)', 'EIM --> Supabase --> Rental App', 'Status field update + Realtime', 'Equipment removed from available inventory'],
        ['Equipment Rented (Rental)', 'Rental --> Supabase --> EIM', 'Operational sync + Realtime', 'EIM shows equipment as currently deployed'],
        ['Repair Started (EIM)', 'EIM --> Supabase --> Rental App', 'Status + maintenance_status fields', 'Equipment unavailable until repair complete'],
        ['Parts Consumed (EIM)', 'EIM local + Supabase', 'Parts inventory decrement', 'Stock levels updated, reorder alerts triggered'],
    ]
    t2 = Table(interaction_data, colWidths=[1.5 * inch, 1.8 * inch, 1.7 * inch, 2.5 * inch])
    t2.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5),
        ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t2)
    story.append(Paragraph('Table 2.2 -- Cross-application data flow and impact mapping', caption))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 3. CORE MODULES
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Core Modules', '3', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The EIM system is organized into four interconnected core modules, each managing a distinct aspect '
        'of the equipment lifecycle. Together, they form a complete asset management pipeline that directly '
        'controls equipment availability in the CMB Rental Request System.',
        body))
    story.append(Spacer(1, 0.15 * inch))

    # Module cards as a 2x2 grid
    card_w = 3.6 * inch
    cards = [
        ModuleCard('Equipment Acquisition', 'ACQ', 'Intake & registration of new equipment assets',
                    ['New equipment registration form', 'Auto-assign equipment codes (EIM-XXXX)',
                     'Category/subcategory classification', 'Serial number & asset tag tracking',
                     'Purchase order & vendor linkage', 'Initial condition assessment',
                     'Auto-push to Supabase on creation', 'Bulk import from CSV/Excel'],
                    '#0f3460', card_w),
        ModuleCard('Rental Inventory Mgmt', 'INV', 'Overall equipment status & availability control',
                    ['Real-time availability dashboard', 'Status management (Available/Deployed/Hold)',
                     'Location tracking per equipment', 'Deployment history timeline',
                     'Unavailability reason logging', 'Bulk status updates',
                     'Integration with rental schedules', 'Equipment condition grading'],
                    '#e94560', card_w),
        ModuleCard('Repair & Maintenance', 'R&M', 'Complete repair lifecycle from report to resolution',
                    ['Maintenance request creation', 'Repair ticket workflow (queue/WIP/done)',
                     'Technician assignment & tracking', 'Parts consumption per repair',
                     'Repair cost accumulation', 'Maintenance scheduling (preventive)',
                     'Equipment history & repair log', 'Auto-flag recurring issues'],
                    '#28a745', card_w),
        ModuleCard('Parts Management', 'PRT', 'Spare parts, expendables & consumables inventory',
                    ['Parts catalog with categories', 'Stock level tracking (qty on hand)',
                     'Reorder point alerts', 'Parts consumption history',
                     'Vendor & pricing management', 'Compatible equipment mapping',
                     'Expendables tracking (consumables)', 'Purchase request generation'],
                    '#ffc107', card_w),
    ]

    card_table_data = [[cards[0], cards[1]], [cards[2], cards[3]]]
    card_table = Table(card_table_data, colWidths=[card_w + 0.15 * inch, card_w + 0.15 * inch])
    card_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(card_table)
    story.append(Paragraph('Figure 3.0 -- Four core modules of the EIM system', caption))
    story.append(PageBreak())

    # ── 3.1 Equipment Acquisition ──
    story.append(SectionHeader('Core Modules', '3', usable))
    story.append(Spacer(1, 0.08 * inch))
    story.append(SubSectionHeader('3.1  Equipment Acquisition Management', usable))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph(
        'The Equipment Acquisition module handles the intake and registration of all newly acquired equipment '
        'into the CMB inventory. Once an item is registered here, it is automatically pushed to Supabase and '
        'becomes visible in the Rental Request System\'s equipment catalog.',
        body))
    story.append(Spacer(1, 0.06 * inch))

    story.append(Paragraph('<b>Acquisition Workflow:</b>', body_bold))
    acq_steps = [
        '<b>Step 1 -- New Equipment Entry:</b> Operator fills registration form with equipment details (name, brand, model, serial number, category, purchase info).',
        '<b>Step 2 -- Code Assignment:</b> System auto-generates unique equipment code following the existing pattern (e.g., CAM-011, LIT-005) based on category prefix.',
        '<b>Step 3 -- Classification:</b> Equipment is assigned to category > subcategory > sub-subcategory hierarchy matching the existing catalog structure.',
        '<b>Step 4 -- Pricing Setup:</b> Base rental price, pricing type (per_day/per_project/package_rate), and any package associations are configured.',
        '<b>Step 5 -- Condition Assessment:</b> Initial condition grade (A/B/C/D) is recorded with notes and optional photo documentation.',
        '<b>Step 6 -- Supabase Sync:</b> On save, the equipment record is pushed to the cloud via catalog-sync, making it available in the Rental Request System.',
    ]
    for step in acq_steps:
        story.append(Paragraph(step, bullet_style, bulletText='•'))
    story.append(Spacer(1, 0.08 * inch))

    acq_fields = [
        ['Field', 'Type', 'Required', 'Description'],
        ['equipment_code', 'TEXT', 'Yes (auto)', 'System-generated unique code (category prefix + sequence)'],
        ['name', 'TEXT', 'Yes', 'Equipment name matching rental catalog naming convention'],
        ['display_name', 'TEXT', 'Yes', 'Full display name shown in catalog views'],
        ['category_id / subcategory_id', 'UUID', 'Yes', 'Links to existing category hierarchy (shared with Rental)'],
        ['serial_number', 'TEXT', 'Yes', 'Manufacturer serial number for asset tracking'],
        ['asset_tag', 'TEXT', 'No', 'Internal CMB asset tag (physical label ID)'],
        ['brand / model', 'TEXT', 'Yes', 'Manufacturer and model identification'],
        ['purchase_date', 'DATE', 'Yes', 'Date of acquisition'],
        ['purchase_price', 'NUMERIC', 'Yes', 'Acquisition cost for depreciation and ROI tracking'],
        ['vendor_name', 'TEXT', 'No', 'Supplier/vendor for warranty and reorder reference'],
        ['warranty_expiry', 'DATE', 'No', 'Warranty end date for maintenance planning'],
        ['condition_grade', 'TEXT', 'Yes', 'Initial condition (A=Excellent, B=Good, C=Fair, D=Poor)'],
        ['base_price', 'NUMERIC', 'Yes', 'Default daily rental rate'],
        ['pricing_type', 'TEXT', 'Yes', 'per_day | per_project | package_rate'],
        ['notes', 'TEXT', 'No', 'Acquisition notes, included accessories, etc.'],
    ]
    t_acq = Table(acq_fields, colWidths=[1.6 * inch, 0.7 * inch, 0.7 * inch, 4.5 * inch])
    t_acq.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7), ('LEADING', (0, 1), (-1, -1), 9.5)]))
    story.append(t_acq)
    story.append(Paragraph('Table 3.1 -- Equipment Acquisition registration fields', caption))
    story.append(PageBreak())

    # ── 3.2 Rental Equipment Inventory ──
    story.append(SubSectionHeader('3.2  Rental Equipment Inventory Management', usable))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph(
        'This module is the operational nerve center for equipment status management. It provides a real-time '
        'view of every asset\'s current state and directly controls whether equipment appears as available for '
        'rent in the main application. When an equipment item becomes unavailable -- whether due to repair, '
        'hold, deployment, or retirement -- the status change is made here and propagated to Supabase.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    status_data = [
        ['Status', 'Code', 'Color', 'Rental Impact', 'Description'],
        ['Available', 'AVAILABLE', 'Green', 'Rentable', 'Equipment is in warehouse, ready for deployment'],
        ['Deployed', 'DEPLOYED', 'Blue', 'Not Rentable', 'Currently out on a rental project'],
        ['In Repair', 'IN_REPAIR', 'Orange', 'Not Rentable', 'Undergoing repair/maintenance in workshop'],
        ['On Hold', 'ON_HOLD', 'Yellow', 'Not Rentable', 'Reserved or held for specific upcoming project'],
        ['In Transit', 'IN_TRANSIT', 'Cyan', 'Not Rentable', 'Being transported between locations'],
        ['Retired', 'RETIRED', 'Gray', 'Permanently Removed', 'End of life -- removed from active inventory'],
        ['Missing', 'MISSING', 'Red', 'Not Rentable', 'Unaccounted for -- investigation required'],
        ['For Inspection', 'FOR_INSPECTION', 'Purple', 'Not Rentable', 'Returned from rental, pending condition check'],
    ]
    t_status = Table(status_data, colWidths=[1.0 * inch, 1.1 * inch, 0.6 * inch, 1.1 * inch, 3.7 * inch])
    t_status.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_status)
    story.append(Paragraph('Table 3.2 -- Equipment status definitions and rental impact', caption))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph('<b>Key Features:</b>', body_bold))
    inv_features = [
        '<b>Status Dashboard:</b> Grid/list view of all equipment with color-coded status badges, filterable by category, status, and location.',
        '<b>Quick Status Toggle:</b> One-click status changes with mandatory reason logging for audit trail compliance.',
        '<b>Location Tracking:</b> Current physical location (Warehouse, Project Site, Workshop, In Transit) with optional GPS/address.',
        '<b>Deployment History:</b> Complete timeline showing where each item has been, when, and for which project.',
        '<b>Batch Operations:</b> Select multiple items for bulk status changes (e.g., mark all returned items as "For Inspection").',
        '<b>Availability Calendar:</b> Visual timeline showing equipment commitments and projected availability windows.',
        '<b>Condition Tracking:</b> Post-rental condition assessments that feed into the maintenance scheduling pipeline.',
        '<b>Supabase Sync Impact:</b> Every status change triggers an immediate Supabase update that the Rental App receives via Realtime.',
    ]
    for f in inv_features:
        story.append(Paragraph(f, bullet_style, bulletText='•'))
    story.append(PageBreak())

    # ── 3.3 Repair & Maintenance ──
    story.append(SubSectionHeader('3.3  Repair & Maintenance Management', usable))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph(
        'When equipment is flagged as needing repair or maintenance -- whether from a post-rental inspection, '
        'a technician report, or a scheduled maintenance trigger -- this module manages the entire workflow '
        'from initial report through to resolution and return to active inventory.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph('<b>Repair Workflow Pipeline:</b>', body_bold))
    story.append(Spacer(1, 0.04 * inch))

    pipeline_data = [
        ['Stage', 'Status', 'Actions', 'Auto-Triggers'],
        ['1. Reported', 'REPORTED', 'Log issue description, severity,\nreporter name, attach photos', 'Equipment status --> FOR_INSPECTION\nNotification to maintenance lead'],
        ['2. Assessed', 'ASSESSED', 'Diagnose root cause, estimate\nrepair cost, list required parts', 'Parts availability check\nCost estimate generated'],
        ['3. Queued', 'QUEUED', 'Assign priority (Critical/High/\nMedium/Low), schedule slot', 'Equipment status --> IN_REPAIR\nCalendar entry created'],
        ['4. In Progress', 'IN_PROGRESS', 'Technician working, log time,\nconsume parts from inventory', 'Parts stock decremented\nRepair timer running'],
        ['5. Testing', 'TESTING', 'Post-repair quality check,\nfunctional verification', 'Test checklist generated\nbased on equipment type'],
        ['6. Completed', 'COMPLETED', 'Final sign-off, update condition\ngrade, close ticket', 'Equipment status --> AVAILABLE\nCost summary finalized'],
        ['7. Escalated', 'ESCALATED', 'External vendor repair needed,\nship-out tracking', 'Equipment status remains IN_REPAIR\nVendor PO generated'],
    ]
    t_pipe = Table(pipeline_data, colWidths=[0.85 * inch, 0.95 * inch, 2.3 * inch, 3.4 * inch])
    t_pipe.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_pipe)
    story.append(Paragraph('Table 3.3 -- Repair workflow pipeline stages', caption))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph('<b>Maintenance Types:</b>', body_bold))
    maint_types = [
        '<b>Corrective Maintenance:</b> Reactive repairs triggered by equipment failure or damage reports.',
        '<b>Preventive Maintenance:</b> Scheduled maintenance based on usage hours, rental count, or calendar intervals.',
        '<b>Predictive Maintenance:</b> Data-driven alerts based on repair history patterns (e.g., equipment with 3+ repairs in 6 months).',
    ]
    for mt in maint_types:
        story.append(Paragraph(mt, bullet_style, bulletText='•'))
    story.append(Spacer(1, 0.06 * inch))

    repair_fields = [
        ['Field', 'Type', 'Description'],
        ['ticket_number', 'TEXT', 'Auto-generated repair ticket ID (RPR-YYYY-XXXX)'],
        ['equipment_id', 'UUID', 'FK to equipment_items -- the item being repaired'],
        ['reported_by', 'TEXT', 'Person who reported the issue'],
        ['reported_date', 'DATE', 'Date issue was first reported'],
        ['issue_description', 'TEXT', 'Detailed description of the problem'],
        ['severity', 'TEXT', 'CRITICAL | HIGH | MEDIUM | LOW'],
        ['repair_status', 'TEXT', 'Current pipeline stage (REPORTED through COMPLETED)'],
        ['assigned_technician', 'TEXT', 'Technician responsible for the repair'],
        ['diagnosis', 'TEXT', 'Root cause analysis notes'],
        ['estimated_cost', 'NUMERIC', 'Projected repair cost (parts + labor)'],
        ['actual_cost', 'NUMERIC', 'Final repair cost after completion'],
        ['parts_consumed', 'JSON', 'Array of {part_id, qty, cost} used in repair'],
        ['labor_hours', 'NUMERIC', 'Total technician hours spent'],
        ['completion_date', 'DATE', 'Date repair was completed and equipment returned'],
        ['post_repair_grade', 'TEXT', 'Condition grade after repair (A/B/C/D)'],
    ]
    t_repair = Table(repair_fields, colWidths=[1.5 * inch, 0.8 * inch, 5.2 * inch])
    t_repair.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_repair)
    story.append(Paragraph('Table 3.4 -- Repair ticket data model', caption))
    story.append(PageBreak())

    # ── 3.4 Parts Management ──
    story.append(SubSectionHeader('3.4  Parts Management', usable))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph(
        'The Parts Management module tracks all spare parts, expendable supplies, and consumable items used '
        'by the equipment department. It maintains stock levels, triggers reorder alerts, maps parts to '
        'compatible equipment, and records consumption history for cost analysis.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph('<b>Parts Categories:</b>', body_bold))
    parts_cats = [
        ['Category', 'Description', 'Examples', 'Tracking Method'],
        ['Spare Parts', 'Replacement components for\nequipment repair', 'Bulbs, lenses, gears, motors,\nfans, power supplies', 'Per-unit with serial tracking\nfor high-value parts'],
        ['Expendables', 'Single-use items consumed\nduring production', 'Gels, diffusion, tape, gaffer\ntape, batteries (disposable)', 'Quantity-based batch\ntracking with lot numbers'],
        ['Consumables', 'Items that deplete with use\nand need regular restocking', 'Cleaning supplies, lubricants,\ncable ties, heat shrink', 'Quantity-based with\nauto-reorder thresholds'],
        ['Accessories', 'Add-on items that accompany\nequipment rentals', 'Cables, adapters, mounting\nhardware, cases', 'Per-unit tracking linked\nto parent equipment'],
    ]
    t_parts = Table(parts_cats, colWidths=[1.0 * inch, 1.7 * inch, 2.0 * inch, 2.8 * inch])
    t_parts.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_parts)
    story.append(Paragraph('Table 3.5 -- Parts category definitions', caption))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph('<b>Key Features:</b>', body_bold))
    parts_features = [
        '<b>Parts Catalog:</b> Searchable inventory with category filters, compatible equipment mapping, and vendor information.',
        '<b>Stock Level Dashboard:</b> Visual indicators (green/yellow/red) for current stock vs. minimum thresholds.',
        '<b>Consumption Tracking:</b> Automatic decrement when parts are consumed during repairs; full consumption history log.',
        '<b>Reorder Alerts:</b> Configurable minimum stock thresholds that trigger visual alerts and optional notification.',
        '<b>Vendor Management:</b> Preferred vendors per part, pricing history, and lead time tracking.',
        '<b>Cost Analysis:</b> Parts cost per equipment item, per repair, and aggregate departmental spend reports.',
        '<b>Compatible Equipment Map:</b> Each part linked to one or more equipment items for fast lookup during repairs.',
        '<b>Inventory Adjustments:</b> Manual stock corrections with reason codes (damage, shrinkage, audit correction, received).',
    ]
    for f in parts_features:
        story.append(Paragraph(f, bullet_style, bulletText='•'))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 4. DATABASE SCHEMA DESIGN
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Database Schema Design', '4', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The EIM system extends the existing CMB database schema. Tables shared with the Rental Request System '
        '(categories, subcategories, equipment_items, package_definitions, package_items) remain unchanged to '
        'maintain sync compatibility. New EIM-specific tables are added for asset tracking, maintenance, and parts.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    story.append(SubSectionHeader('Shared Tables (Existing -- No Modifications)', usable))
    story.append(Spacer(1, 0.06 * inch))

    shared = [
        ['Table', 'Owner', 'Sync Direction', 'Purpose in EIM'],
        ['categories', 'Shared', 'Bidirectional', 'Equipment classification hierarchy (top level)'],
        ['subcategories', 'Shared', 'Bidirectional', 'Equipment classification (second level)'],
        ['equipment_items', 'Shared', 'Bidirectional', 'Core equipment catalog -- EIM adds items, Rental reads them'],
        ['package_definitions', 'Shared', 'Bidirectional', 'Equipment packages -- can be created from either app'],
        ['package_items', 'Shared', 'Bidirectional', 'Package component mappings'],
        ['users', 'Shared', 'Bidirectional', 'User accounts -- EIM adds inventory/maintenance roles'],
    ]
    t_shared = Table(shared, colWidths=[1.5 * inch, 0.8 * inch, 1.2 * inch, 4.0 * inch])
    t_shared.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_shared)
    story.append(Paragraph('Table 4.1 -- Shared tables with Rental Request System', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('New EIM Tables', usable))
    story.append(Spacer(1, 0.06 * inch))

    new_tables = [
        ['Table', 'Purpose', 'Key Fields'],
        ['equipment_assets', 'Extended asset data beyond\nthe rental catalog', 'equipment_id (FK), serial_number, asset_tag, purchase_date,\npurchase_price, vendor, warranty_expiry, condition_grade,\ncurrent_location, current_status, last_inspection_date'],
        ['asset_status_log', 'Audit trail of every status\nchange for each asset', 'asset_id (FK), previous_status, new_status, changed_by,\nchanged_at, reason, related_ticket_id'],
        ['maintenance_tickets', 'Repair and maintenance\nwork orders', 'ticket_number, equipment_id (FK), reported_by, severity,\nrepair_status, assigned_technician, diagnosis, estimated_cost,\nactual_cost, labor_hours, completion_date'],
        ['maintenance_notes', 'Time-stamped notes and\nupdates on repair tickets', 'ticket_id (FK), author, note_text, note_type (update/\nescalation/resolution), created_at'],
        ['parts_catalog', 'Master list of all parts,\nspares, and expendables', 'part_code, name, category (spare/expendable/consumable/\naccessory), unit_of_measure, unit_cost, vendor_name'],
        ['parts_inventory', 'Current stock levels\nand thresholds', 'part_id (FK), qty_on_hand, qty_reserved, reorder_point,\nreorder_qty, location, last_count_date'],
        ['parts_transactions', 'All stock movements\n(in/out/adjust)', 'part_id (FK), transaction_type (receive/consume/adjust/\nreturn), quantity, reference_id, performed_by, notes'],
        ['parts_compatibility', 'Maps parts to compatible\nequipment items', 'part_id (FK), equipment_id (FK), notes'],
        ['preventive_schedules', 'Recurring maintenance\nschedule definitions', 'equipment_id (FK), schedule_type (calendar/usage),\ninterval_days, interval_rentals, next_due_date, last_performed'],
        ['vendors', 'Vendor/supplier master\nrecord', 'name, contact_person, phone, email, address,\npayment_terms, notes, is_active'],
    ]
    t_new = Table(new_tables, colWidths=[1.4 * inch, 1.5 * inch, 4.6 * inch])
    t_new.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7), ('LEADING', (0, 1), (-1, -1), 9.5),
    ]))
    story.append(t_new)
    story.append(Paragraph('Table 4.2 -- New tables introduced by the EIM system', caption))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 5. SUPABASE SYNC STRATEGY
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Supabase Sync Strategy', '5', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The sync strategy is designed to maintain consistency between the EIM system, the Rental Request System, '
        'and the Supabase cloud database. It builds upon the proven sync patterns already operational in the '
        'Rental app (SyncManager, catalog-sync, operational-sync, offline-queue).',
        body))
    story.append(Spacer(1, 0.08 * inch))

    story.append(SubSectionHeader('Sync Architecture', usable))
    story.append(Spacer(1, 0.06 * inch))

    sync_data = [
        ['Table Group', 'Sync Type', 'Strategy', 'Conflict Resolution'],
        ['Catalog Tables\n(categories, subcategories,\nequipment_items, packages)', 'Bidirectional\nCatalog Sync', 'Full table pull on connect;\npush on local mutation;\nRealtime subscription', 'Version field comparison;\nhigher version wins;\ntimestamp tiebreaker'],
        ['Equipment Assets\n(equipment_assets,\nasset_status_log)', 'Bidirectional\nOperational Sync', 'Push status changes immediately;\npull deployment status from\nRental app via Realtime', 'Last-write-wins with\naudit trail preservation;\nstatus_log is append-only'],
        ['Maintenance Tables\n(maintenance_tickets,\nmaintenance_notes)', 'EIM-Primary\nPush Sync', 'EIM is authoritative;\npushes to Supabase;\nRental reads via Realtime', 'EIM always wins;\nread-only from Rental\nperspective'],
        ['Parts Tables\n(parts_catalog, inventory,\ntransactions, compatibility)', 'EIM-Only\nLocal + Cloud', 'EIM manages exclusively;\nsyncs to Supabase for\nreporting/backup', 'No conflict -- single\nwriter (EIM only)'],
        ['Vendors & Schedules\n(vendors,\npreventive_schedules)', 'EIM-Only\nLocal + Cloud', 'EIM manages exclusively;\nsyncs to Supabase for\nbackup purposes', 'No conflict -- single\nwriter (EIM only)'],
    ]
    t_sync = Table(sync_data, colWidths=[1.5 * inch, 1.1 * inch, 2.2 * inch, 2.7 * inch])
    t_sync.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_sync)
    story.append(Paragraph('Table 5.1 -- Sync strategy per table group', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('Realtime Subscription Channels', usable))
    story.append(Spacer(1, 0.06 * inch))
    story.append(Paragraph(
        'The EIM system subscribes to Supabase Realtime channels for all synced tables. When the Rental app '
        'changes an equipment item\'s deployment status (e.g., equipment is rented out), the EIM system receives '
        'the update in real-time and reflects it in the inventory dashboard. Conversely, when EIM marks equipment '
        'as unavailable, the Rental app receives the update instantly.',
        body))
    story.append(Spacer(1, 0.06 * inch))

    story.append(Paragraph('<b>Offline Queue Behavior:</b>', body_bold))
    offline_items = [
        'All mutations are executed against local SQLite immediately (offline-first).',
        'If Supabase is unreachable, mutations are queued in the offline_queue table.',
        'On reconnection, SyncManager replays queued operations in FIFO order.',
        'Failed replays are retried with exponential backoff (max 3 attempts).',
        'Permanently failed items are flagged for manual resolution.',
    ]
    for item in offline_items:
        story.append(Paragraph(item, bullet_style, bulletText='•'))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 6. APPLICATION STRUCTURE & UI LAYOUT
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Application Structure & UI Layout', '6', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The EIM system follows the same UI architecture as the Rental Request System: a sidebar navigation '
        'layout with role-based menu visibility, consistent styling via TailwindCSS, and Zustand-powered '
        'state management.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    story.append(SubSectionHeader('Page Structure', usable))
    story.append(Spacer(1, 0.06 * inch))

    pages_data = [
        ['Page', 'Route', 'Module', 'Description'],
        ['Login', '/login', 'Auth', 'Authentication with role-based redirect'],
        ['Dashboard', '/', 'Core', 'Overview: fleet health, alerts, status summary,\nrecent activity feed'],
        ['Equipment Catalog', '/equipment', 'ACQ + INV', 'Full equipment list with status, filters,\nsearch, and bulk actions'],
        ['Add Equipment', '/equipment/new', 'ACQ', 'New equipment registration form with\ncategory selection and pricing setup'],
        ['Equipment Detail', '/equipment/:id', 'INV', 'Single equipment view: status, history,\nmaintenance log, deployments, condition'],
        ['Maintenance Queue', '/maintenance', 'R&M', 'Kanban board of all repair tickets\norganized by pipeline stage'],
        ['New Repair Ticket', '/maintenance/new', 'R&M', 'Create repair/maintenance request\nwith equipment lookup and severity'],
        ['Ticket Detail', '/maintenance/:id', 'R&M', 'Full repair ticket view: timeline, notes,\nparts consumed, cost summary'],
        ['Parts Inventory', '/parts', 'PRT', 'Parts catalog with stock levels,\nalerts, and vendor info'],
        ['Parts Detail', '/parts/:id', 'PRT', 'Single part view: stock history,\ncompatible equipment, transactions'],
        ['Stock Adjustment', '/parts/adjust', 'PRT', 'Manual stock adjustments with\nreason codes and approval'],
        ['Vendors', '/vendors', 'PRT', 'Vendor management: contacts,\npayment terms, part associations'],
        ['Reports', '/reports', 'Core', 'Analytics: fleet utilization, repair costs,\nparts spend, availability trends'],
        ['Settings', '/settings', 'Core', 'Supabase config, user management,\nsync status, system preferences'],
    ]
    t_pages = Table(pages_data, colWidths=[1.2 * inch, 1.3 * inch, 0.8 * inch, 4.2 * inch])
    t_pages.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_pages)
    story.append(Paragraph('Table 6.1 -- Application pages and routing', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('Folder Structure', usable))
    story.append(Spacer(1, 0.06 * inch))

    folder_style = ParagraphStyle('Folder', parent=body, fontName='Courier', fontSize=7.5, leading=10.5,
                                   textColor=CMB_TEXT, leftIndent=6)
    folders = [
        'src/',
        '  main/',
        '    database/           # SQLite schema + migrations (extends rental schema)',
        '    ipc/                # Domain-split IPC handlers',
        '      equipment.handlers.ts    # Equipment CRUD + status management',
        '      maintenance.handlers.ts  # Repair ticket lifecycle',
        '      parts.handlers.ts        # Parts inventory operations',
        '      vendors.handlers.ts      # Vendor management',
        '      reports.handlers.ts      # Analytics + reporting queries',
        '      sync.handlers.ts         # Supabase connection + sync controls',
        '      auth.handlers.ts         # Authentication',
        '    sync/               # SyncManager, catalog-sync, offline-queue',
        '    pdf/                # Report PDF generation',
        '  preload/              # contextBridge IPC surface',
        '  renderer/',
        '    components/',
        '      equipment/        # EquipmentTable, EquipmentForm, StatusBadge',
        '      maintenance/      # TicketBoard, TicketForm, RepairTimeline',
        '      parts/            # PartsGrid, StockLevel, TransactionLog',
        '      common/           # Shared UI components',
        '      layout/           # Sidebar, Header, PageWrapper',
        '    pages/              # One page component per route',
        '    stores/             # Zustand stores (equipment, maintenance, parts, sync)',
        '    hooks/              # Custom React hooks',
        '    lib/                # IPC wrapper, formatters, helpers',
        '  shared/',
        '    types/              # IpcChannels + domain interfaces',
        '    schemas/            # Zod validation schemas',
        '    constants/          # Status enums, category prefixes',
        'database/',
        '  schema.sql            # SQLite source of truth (extends rental schema)',
        '  supabase-migration.sql  # PostgreSQL mirror for Supabase',
    ]
    for line in folders:
        story.append(Paragraph(line, folder_style))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 7. TECH STACK
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Tech Stack', '7', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The technology stack mirrors the Rental Request System to ensure cross-team consistency, shared '
        'development patterns, and minimal onboarding overhead.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    tech_data = [
        ['Layer', 'Technology', 'Version', 'Purpose'],
        ['Shell', 'Electron', '33.x', 'Desktop application shell with main/preload/renderer process isolation'],
        ['UI Framework', 'React', '18.x', 'Component-based UI with hooks and functional components'],
        ['Language', 'TypeScript', '5.3+', 'Type safety across all processes (main, preload, renderer)'],
        ['Bundler', 'Vite', '5.x', 'Fast HMR dev server for renderer; production build optimization'],
        ['State Management', 'Zustand', '4.5+', 'Lightweight per-domain stores with devtools support'],
        ['Styling', 'TailwindCSS', '3.4+', 'Utility-first CSS matching Rental app design system'],
        ['Validation', 'Zod', '4.x', 'Runtime schema validation for IPC payloads and form inputs'],
        ['Local Database', 'better-sqlite3', '12.x', 'Synchronous SQLite with WAL journaling (main process only)'],
        ['Cloud Database', 'Supabase', '2.x', 'PostgreSQL with Realtime, shared with Rental app'],
        ['PDF Generation', 'pdfkit', '0.15+', 'Report and label generation (main process only)'],
        ['Spreadsheets', 'ExcelJS', '4.x', 'Import/export of equipment data and inventory reports'],
        ['Routing', 'react-router-dom', '6.x', 'Client-side routing for SPA navigation'],
        ['Icons', 'lucide-react', '0.330+', 'Consistent icon set matching Rental app'],
        ['Date Handling', 'date-fns', '3.x', 'Date formatting and manipulation'],
        ['IDs', 'uuid', '9.x', 'UUID v4 generation for all records'],
        ['Packager', 'electron-builder', '26.x', 'DMG/ZIP (macOS), NSIS/portable (Windows) builds'],
    ]
    t_tech = Table(tech_data, colWidths=[1.1 * inch, 1.3 * inch, 0.6 * inch, 4.5 * inch])
    t_tech.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_tech)
    story.append(Paragraph('Table 7.1 -- Complete technology stack', caption))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 8. DATA FLOW & INTEGRATION LOGIC
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Data Flow & Integration Logic', '8', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'This section details the critical data flows that connect the EIM system with the main Rental '
        'Request System. These integration points are the backbone of operational consistency.',
        body))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('8.1  Equipment Acquisition Flow', usable))
    story.append(Spacer(1, 0.06 * inch))

    flow1 = [
        ['Step', 'Actor', 'System', 'Action', 'Data Impact'],
        ['1', 'Operator', 'EIM', 'Fill equipment registration form', 'New record created in local SQLite'],
        ['2', 'System', 'EIM', 'Validate input via Zod schema', 'Validation errors shown or proceed'],
        ['3', 'System', 'EIM', 'Auto-generate equipment_code', 'Code assigned based on category prefix'],
        ['4', 'System', 'EIM', 'Insert into equipment_items + equipment_assets', 'Local DB updated atomically'],
        ['5', 'System', 'EIM', 'Push to Supabase via catalog-sync', 'Cloud equipment_items table updated'],
        ['6', 'System', 'Supabase', 'Broadcast Realtime event', 'postgres_changes event published'],
        ['7', 'System', 'Rental App', 'Receive Realtime payload', 'Upsert into local SQLite via catalog-sync'],
        ['8', 'System', 'Rental App', 'Refresh equipment store', 'New equipment appears in rental catalog'],
    ]
    t_f1 = Table(flow1, colWidths=[0.4 * inch, 0.7 * inch, 0.8 * inch, 2.5 * inch, 3.1 * inch])
    t_f1.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_f1)
    story.append(Paragraph('Table 8.1 -- Equipment acquisition data flow', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('8.2  Status Change Impact Flow', usable))
    story.append(Spacer(1, 0.06 * inch))

    flow2 = [
        ['Step', 'Actor', 'System', 'Action', 'Data Impact'],
        ['1', 'Operator', 'EIM', 'Change equipment status\n(e.g., Available --> In Repair)', 'Local equipment_assets.current_status updated'],
        ['2', 'System', 'EIM', 'Log status change to\nasset_status_log', 'Append-only audit record created'],
        ['3', 'System', 'EIM', 'Update equipment_items.is_active\nif status is Retired', 'is_active = 0 removes from rental catalog'],
        ['4', 'System', 'EIM', 'Push changes to Supabase', 'Cloud tables updated'],
        ['5', 'System', 'Supabase', 'Broadcast Realtime events', 'Both EIM and Rental app receive updates'],
        ['6', 'System', 'Rental App', 'Update local catalog +\nrefresh UI', 'Equipment availability reflects new status'],
    ]
    t_f2 = Table(flow2, colWidths=[0.4 * inch, 0.7 * inch, 0.8 * inch, 2.3 * inch, 3.3 * inch])
    t_f2.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_f2)
    story.append(Paragraph('Table 8.2 -- Status change propagation flow', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('8.3  Repair-to-Parts Consumption Flow', usable))
    story.append(Spacer(1, 0.06 * inch))

    flow3 = [
        ['Step', 'Actor', 'Action', 'Data Impact'],
        ['1', 'Technician', 'Selects parts needed from parts catalog', 'Parts reserved (qty_reserved incremented)'],
        ['2', 'Technician', 'Confirms parts consumed during repair', 'parts_transactions record created (type=consume)'],
        ['3', 'System', 'Decrement parts_inventory.qty_on_hand', 'Stock level reduced'],
        ['4', 'System', 'Check qty_on_hand vs reorder_point', 'If below threshold: alert generated'],
        ['5', 'System', 'Add cost to maintenance_tickets.actual_cost', 'Repair cost accumulation updated'],
        ['6', 'System', 'Sync parts_inventory to Supabase', 'Cloud inventory levels updated for reporting'],
    ]
    t_f3 = Table(flow3, colWidths=[0.4 * inch, 0.9 * inch, 2.7 * inch, 3.5 * inch])
    t_f3.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_f3)
    story.append(Paragraph('Table 8.3 -- Repair parts consumption flow', caption))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 9. USER ROLES & PERMISSIONS
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('User Roles & Permissions', '9', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The EIM system introduces new roles specific to equipment department operations while maintaining '
        'compatibility with the existing user table shared via Supabase.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    roles_data = [
        ['Role', 'Scope', 'Permissions'],
        ['admin', 'Full System', 'All operations: user management, settings, data purge,\nsync configuration, all module access'],
        ['inventory_manager', 'ACQ + INV', 'Add/edit equipment, manage status, view maintenance,\nview parts, run inventory reports'],
        ['maintenance_lead', 'R&M + PRT', 'Create/manage repair tickets, assign technicians,\nconsume parts, view equipment status'],
        ['technician', 'R&M (Limited)', 'View assigned tickets, log work notes, record parts\nconsumed, update repair status (own tickets only)'],
        ['parts_clerk', 'PRT', 'Manage parts catalog, adjust stock, process receiving,\nmanage vendors, generate purchase requests'],
        ['viewer', 'Read-Only', 'View all dashboards and reports; cannot create, edit,\nor delete any records'],
    ]
    t_roles = Table(roles_data, colWidths=[1.2 * inch, 1.0 * inch, 5.3 * inch])
    t_roles.setStyle(TableStyle(tbl_style_base() + [('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10)]))
    story.append(t_roles)
    story.append(Paragraph('Table 9.1 -- EIM system roles and permissions', caption))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph(
        '<b>Note:</b> The users table role CHECK constraint will be updated in the Supabase migration to '
        'include the new EIM-specific roles. The Rental Request System will ignore roles it does not '
        'recognize, ensuring backward compatibility.',
        body))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 10. DEVELOPMENT PHASES & TIMELINE
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Development Phases & Timeline', '10', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The build is structured into six sequential phases, each delivering a functional increment that '
        'can be tested and validated before proceeding.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    phases_data = [
        ['Phase', 'Name', 'Scope', 'Deliverables', 'Est.'],
        ['Phase 1', 'Foundation &\nProject Setup', 'Electron app scaffold,\nDB schema, Supabase\nmigrations, auth', 'Working app shell with login, sidebar navigation,\nsettings page with Supabase config, initial DB\nmigrations applied to both SQLite and Supabase', '1-2\nweeks'],
        ['Phase 2', 'Equipment\nAcquisition', 'Equipment registration,\ncatalog management,\ncategory browser', 'Equipment add/edit forms, auto-code generation,\ncategory/subcategory management, CSV import,\ncatalog sync to Supabase (visible in Rental app)', '2-3\nweeks'],
        ['Phase 3', 'Inventory\nManagement', 'Status tracking, location,\navailability dashboard,\ndeployment history', 'Equipment status dashboard with color-coded badges,\nstatus change with audit logging, deployment history\ntimeline, batch status operations, Realtime sync', '2-3\nweeks'],
        ['Phase 4', 'Repair &\nMaintenance', 'Repair ticket lifecycle,\nKanban board, technician\nassignment, scheduling', 'Maintenance queue (Kanban view), ticket creation\nand lifecycle management, technician assignment,\nnotes/timeline, preventive schedule configuration', '3-4\nweeks'],
        ['Phase 5', 'Parts\nManagement', 'Parts catalog, stock\ntracking, consumption,\nvendor management', 'Parts CRUD with stock levels, consumption during\nrepairs (linked to tickets), reorder alerts, vendor\nmanagement, inventory adjustments with reason codes', '2-3\nweeks'],
        ['Phase 6', 'Reports,\nPolish &\nDeployment', 'Analytics, PDF reports,\nUI polish, packaging,\nfinal testing', 'Fleet utilization reports, repair cost analysis,\nparts spend reports, PDF generation, cross-app\nintegration testing, electron-builder packaging', '2-3\nweeks'],
    ]
    t_phases = Table(phases_data, colWidths=[0.65 * inch, 0.9 * inch, 1.5 * inch, 3.6 * inch, 0.55 * inch])
    t_phases.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7), ('LEADING', (0, 1), (-1, -1), 9.5),
        ('BACKGROUND', (0, 1), (0, -1), HexColor('#e8edf3')),
    ]))
    story.append(t_phases)
    story.append(Paragraph('Table 10.1 -- Development phases and estimated timeline (12-18 weeks total)', caption))
    story.append(Spacer(1, 0.1 * inch))

    story.append(SubSectionHeader('Phase Dependencies', usable))
    story.append(Spacer(1, 0.06 * inch))

    deps = [
        '<b>Phase 1 --> Phase 2:</b> Foundation must be complete before equipment data can be created.',
        '<b>Phase 2 --> Phase 3:</b> Equipment records must exist before status management makes sense.',
        '<b>Phase 3 --> Phase 4:</b> Status system feeds into repair workflow triggers.',
        '<b>Phase 2 + Phase 4 --> Phase 5:</b> Parts are consumed during repairs and linked to equipment.',
        '<b>All Phases --> Phase 6:</b> Reports aggregate data from all modules.',
    ]
    for d in deps:
        story.append(Paragraph(d, bullet_style, bulletText='•'))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 11. RISK ASSESSMENT & MITIGATION
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Risk Assessment & Mitigation', '11', usable))
    story.append(Spacer(1, 0.12 * inch))

    risks_data = [
        ['Risk', 'Severity', 'Likelihood', 'Mitigation Strategy'],
        ['Sync conflicts between\nEIM and Rental apps\nmodifying same records', 'HIGH', 'MEDIUM', 'Version-based conflict resolution (higher version wins).\nClear ownership model: EIM owns asset data, Rental owns\nbooking data. Append-only audit logs prevent data loss.'],
        ['Offline data divergence\nwhen both apps modify\nequipment while disconnected', 'HIGH', 'LOW', 'Offline queue with deterministic replay order. Status\nchanges are timestamped; last-write-wins with full\naudit trail. Manual conflict resolution UI for edge cases.'],
        ['Database schema drift\nbetween EIM and Rental\napp versions', 'MEDIUM', 'MEDIUM', 'Shared supabase-migration.sql as single PostgreSQL schema\nsource. Migration versioning via schema_migrations table.\nBackward-compatible schema changes only (additive).'],
        ['Equipment status\ninconsistency across\napplications', 'HIGH', 'LOW', 'Single source of truth in Supabase. Both apps subscribe\nto Realtime changes. Periodic full-sync reconciliation\non app startup (syncOnStartup pattern from Rental app).'],
        ['Parts stock inaccuracy\ndue to concurrent\nconsumption', 'MEDIUM', 'LOW', 'Atomic transactions for stock decrement. Optimistic\nlocking with version check. Periodic physical inventory\naudit workflow built into the parts module.'],
        ['Performance degradation\nwith large equipment\nand parts catalogs', 'LOW', 'MEDIUM', 'SQLite WAL mode + indexing strategy. Paginated queries.\nVirtual scrolling for large lists. Selective Supabase\nsyncs (changed records only, not full table pulls).'],
    ]
    t_risks = Table(risks_data, colWidths=[1.7 * inch, 0.7 * inch, 0.8 * inch, 4.3 * inch])
    t_risks.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_risks)
    story.append(Paragraph('Table 11.1 -- Risk assessment matrix', caption))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════
    # 12. SUCCESS CRITERIA & ACCEPTANCE
    # ══════════════════════════════════════════════════════════════
    story.append(SectionHeader('Success Criteria & Acceptance', '12', usable))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph(
        'The following criteria define what constitutes a successful build of the EIM system. Each criterion '
        'must be validated before the system is considered production-ready.',
        body))
    story.append(Spacer(1, 0.08 * inch))

    criteria_data = [
        ['#', 'Criterion', 'Validation Method', 'Pass Condition'],
        ['C1', 'Equipment added in EIM appears\nin Rental app within 5 seconds', 'Add equipment in EIM;\nverify in Rental app', 'Equipment visible in Rental\ncatalog with correct details'],
        ['C2', 'Status change in EIM immediately\naffects rental availability', 'Mark equipment as IN_REPAIR;\ncheck Rental app availability', 'Equipment not bookable in\nRental until status restored'],
        ['C3', 'Repair workflow completes full\npipeline without data loss', 'Create ticket, progress through\nall stages, consume parts', 'Ticket completes; parts stock\naccurate; costs tallied'],
        ['C4', 'Parts consumption accurately\ndecrements inventory', 'Consume parts during repair;\nverify stock levels', 'qty_on_hand reduced by exact\namount; transaction logged'],
        ['C5', 'Offline operation queues changes\nand replays on reconnect', 'Disconnect Supabase; make changes;\nreconnect and verify sync', 'All queued changes applied;\nno data loss or duplicates'],
        ['C6', 'All data survives app restart\nwith no corruption', 'Perform operations; restart app;\nverify data integrity', 'All records intact; sync\nstate preserved'],
        ['C7', 'Role-based access correctly\nrestricts operations', 'Login as each role; attempt\noperations outside scope', 'Unauthorized operations\nblocked with clear messaging'],
        ['C8', 'Reports accurately reflect\ncurrent system state', 'Generate reports; cross-reference\nwith raw data', 'Report figures match actual\ndatabase values exactly'],
    ]
    t_criteria = Table(criteria_data, colWidths=[0.35 * inch, 2.0 * inch, 2.0 * inch, 3.15 * inch])
    t_criteria.setStyle(TableStyle(tbl_style_base() + [
        ('FONTSIZE', (0, 1), (-1, -1), 7.5), ('LEADING', (0, 1), (-1, -1), 10),
    ]))
    story.append(t_criteria)
    story.append(Paragraph('Table 12.1 -- Acceptance criteria checklist', caption))
    story.append(Spacer(1, 0.2 * inch))

    story.append(HRFlowable(width='100%', thickness=1, color=CMB_BORDER))
    story.append(Spacer(1, 0.15 * inch))

    end_style = ParagraphStyle('End', parent=body, alignment=TA_CENTER, fontSize=10, textColor=CMB_MUTED)
    story.append(Paragraph('-- End of Document --', end_style))
    story.append(Spacer(1, 0.08 * inch))
    story.append(Paragraph(
        f'CMB Equipment Inventory Management System Build Plan v1.0 | {datetime.now().strftime("%B %d, %Y")}',
        ParagraphStyle('Footer', parent=end_style, fontSize=8)))
    story.append(Paragraph(
        'CMB Film Services, Inc. | Equipment Department',
        ParagraphStyle('Footer2', parent=end_style, fontSize=8)))

    # ── Build ──
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == '__main__':
    build_pdf()
